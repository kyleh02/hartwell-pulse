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

  // ---- Client messages left unread for 30+ minutes: nudge the admin by email ----
  // notify_on_message files admin-facing message notifications as channel
  // 'in_portal' (no instant email), so they only surface in the bell. If one of
  // those is still unread after half an hour, email the admin so it isn't missed.
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: staleData } = await supabase
    .from("notifications")
    .select("*")
    .eq("type", "message")
    .eq("channel", "in_portal")
    .is("read_at", null)
    .is("emailed_at", null)
    .lt("created_at", thirtyMinAgo)
    .order("created_at", { ascending: true })
    .limit(100);
  const stale = (staleData as Notification[] | null) ?? [];

  // One email per recipient, summarising how many messages are waiting.
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
    const count = group.length;
    const plural = count === 1 ? "" : "s";
    const subject =
      count === 1
        ? "A client message is waiting in Pulse"
        : `${count} client messages are waiting in Pulse`;
    const html = emailLayout(
      subject,
      `<p>You have <strong>${count}</strong> unread client message${plural} in the portal that ${count === 1 ? "has" : "have"} been waiting for more than 30 minutes.</p>`,
      "Open messages",
      "/admin/messages",
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
