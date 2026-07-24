import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, escapeHtml } from "@/lib/email";
import { cronAuthorized } from "@/lib/cron-auth";
import type { Notification } from "@/lib/types/database";

export const dynamic = "force-dynamic";

// Emails any pending "instant" notifications (e.g. a message from Kyle).
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("channel", "instant")
    .is("emailed_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  const notes = (data as Notification[] | null) ?? [];

  let sent = 0;
  for (const n of notes) {
    const { data: cu } = await supabase
      .from("client_users")
      .select("email")
      .eq("clerk_user_id", n.recipient_user_id)
      .maybeSingle();
    const email = (cu as { email: string | null } | null)?.email;
    if (email) {
      const html = emailLayout(
        n.title,
        n.body ? `<p>${escapeHtml(n.body)}</p>` : "",
        "Open Pulse",
        n.link ?? "/",
      );
      await sendEmail({ to: email, subject: n.title, html });
      sent++;
    }
    await supabase
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", n.id);
  }

  // ---- Client activity left unread for 30+ minutes: nudge the admin by email ----
  // notify_on_message and notify_on_asset_upload file admin-facing
  // notifications as channel 'in_portal' (no instant email), so they only
  // surface in the bell. If one is still unread after half an hour, email the
  // admin so nothing a client sends or uploads is missed.
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: staleData } = await supabase
    .from("notifications")
    .select("*")
    .in("type", ["message", "asset_uploaded"])
    .eq("channel", "in_portal")
    .is("read_at", null)
    .is("emailed_at", null)
    .lt("created_at", thirtyMinAgo)
    .order("created_at", { ascending: true })
    .limit(100);
  const stale = (staleData as Notification[] | null) ?? [];

  // One email per recipient, summarising what's waiting.
  const byRecipient = new Map<string, Notification[]>();
  for (const n of stale) {
    const arr = byRecipient.get(n.recipient_user_id) ?? [];
    arr.push(n);
    byRecipient.set(n.recipient_user_id, arr);
  }

  let nudged = 0;
  for (const [recipient, group] of byRecipient) {
    const { data: cu } = await supabase
      .from("client_users")
      .select("email")
      .eq("clerk_user_id", recipient)
      .maybeSingle();
    const email = (cu as { email: string | null } | null)?.email;
    if (!email) continue; // no address on file yet — leave it to retry later
    const msgCount = group.filter((n) => n.type === "message").length;
    const upCount = group.length - msgCount;
    const parts = [
      msgCount > 0 && `${msgCount} client message${msgCount === 1 ? "" : "s"}`,
      upCount > 0 && `${upCount} client upload${upCount === 1 ? "" : "s"}`,
    ].filter(Boolean) as string[];
    const what = parts.join(" and ");
    const subject =
      group.length === 1
        ? `A ${msgCount === 1 ? "client message" : "client upload"} is waiting in Pulse`
        : `${what} are waiting in Pulse`;
    const link =
      upCount === 0 ? "/admin/messages" : msgCount === 0 ? "/admin/assets" : "/admin";
    const html = emailLayout(
      subject,
      `<p>You have <strong>${what}</strong> in the portal ${group.length === 1 ? "that has" : "that have"} been waiting for more than 30 minutes.</p>`,
      upCount === 0 ? "Open messages" : msgCount === 0 ? "Open assets" : "Open Pulse",
      link,
    );
    await sendEmail({ to: email, subject, html });
    await supabase
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .in(
        "id",
        group.map((n) => n.id),
      );
    nudged++;
  }

  return Response.json({ processed: notes.length, sent, nudged });
}
