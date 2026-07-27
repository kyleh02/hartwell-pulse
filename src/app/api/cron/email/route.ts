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
    .limit(100);
  const notes = (data as Notification[] | null) ?? [];

  // Slack-style rule for message emails: at most ONE email per away-period.
  // All pending message notifications for a recipient batch into a single
  // summary, and while an earlier message email sits unread in the portal we
  // send nothing more — reading the portal is what re-arms email. Suppressed
  // rows keep emailed_at null: if they're still unread once the person has
  // read the older ones, the next run picks them up; if they read everything,
  // there's nothing left to say.
  let sent = 0;
  const messageNotes = notes.filter((n) => n.type === "message");
  const otherNotes = notes.filter((n) => n.type !== "message");

  // Non-message instant notifications (invoices etc) keep per-item delivery.
  for (const n of otherNotes) {
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

  const msgByRecipient = new Map<string, Notification[]>();
  for (const n of messageNotes) {
    const arr = msgByRecipient.get(n.recipient_user_id) ?? [];
    arr.push(n);
    msgByRecipient.set(n.recipient_user_id, arr);
  }

  for (const [recipient, group] of msgByRecipient) {
    // Already told them and they haven't been back yet? Stay quiet.
    const { count: pendingCount } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", recipient)
      .eq("type", "message")
      .is("read_at", null)
      .not("emailed_at", "is", null);
    if ((pendingCount ?? 0) > 0) continue;

    const { data: cu } = await supabase
      .from("client_users")
      .select("email")
      .eq("clerk_user_id", recipient)
      .maybeSingle();
    const email = (cu as { email: string | null } | null)?.email;
    if (!email) continue;

    // One line per sender: "New message from Kyle · 3", newest preview under it.
    const bySender = new Map<string, Notification[]>();
    for (const n of group) {
      const arr = bySender.get(n.title) ?? [];
      arr.push(n);
      bySender.set(n.title, arr);
    }
    const sections = Array.from(bySender.entries())
      .map(([title, list]) => {
        const latest = list[list.length - 1];
        return `<p><strong>${escapeHtml(title)}</strong>${
          list.length > 1 ? ` · ${list.length} messages` : ""
        }${latest.body ? `<br/>${escapeHtml(latest.body)}` : ""}</p>`;
      })
      .join("");
    const subject =
      group.length === 1
        ? group[0].title
        : `${group.length} new messages in Pulse`;
    const html = emailLayout(
      subject,
      sections,
      "Open Pulse",
      group[0].link ?? "/messages",
    );
    await sendEmail({ to: email, subject, html });
    sent++;
    await supabase
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .in(
        "id",
        group.map((n) => n.id),
      );
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
    // Same Slack-style rule as instant emails: if an earlier nudge is still
    // sitting unactioned (unread but already emailed), don't send another.
    // Coming back to the portal re-arms the nudge.
    const { count: pendingCount } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", recipient)
      .in("type", ["message", "asset_uploaded"])
      .eq("channel", "in_portal")
      .is("read_at", null)
      .not("emailed_at", "is", null);
    if ((pendingCount ?? 0) > 0) continue;

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

    // Per-client breakdown so one email tells the whole story.
    const clientIds = Array.from(
      new Set(group.map((n) => n.client_id).filter((id): id is string => !!id)),
    );
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id, business_name")
      .in("id", clientIds);
    const clientNames = new Map(
      ((clientRows as { id: string; business_name: string }[] | null) ?? []).map(
        (c) => [c.id, c.business_name],
      ),
    );
    const perClient = new Map<string, { msgs: number; ups: number }>();
    for (const n of group) {
      const name = clientNames.get(n.client_id ?? "") ?? "A client";
      const entry = perClient.get(name) ?? { msgs: 0, ups: 0 };
      if (n.type === "message") entry.msgs++;
      else entry.ups++;
      perClient.set(name, entry);
    }
    const breakdown = Array.from(perClient.entries())
      .map(([name, c]) => {
        const bits = [
          c.msgs > 0 && `${c.msgs} message${c.msgs === 1 ? "" : "s"}`,
          c.ups > 0 && `${c.ups} upload${c.ups === 1 ? "" : "s"}`,
        ].filter(Boolean);
        return `<p><strong>${escapeHtml(name)}</strong> · ${bits.join(", ")}</p>`;
      })
      .join("");

    const html = emailLayout(
      subject,
      `<p>Waiting in the portal for more than 30 minutes:</p>${breakdown}`,
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
