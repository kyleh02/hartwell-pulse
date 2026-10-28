import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, escapeHtml } from "@/lib/email";
import { cronAuthorized } from "@/lib/cron-auth";
import { HARTWELL } from "@/lib/brand";
import { dayThreeEmail, daySevenEmail } from "@/lib/welcome-emails";
import { QUIET_BEFORE_EMAIL_MS, digestEmail, type Transcript } from "@/lib/assistant";
import type { Notification } from "@/lib/types/database";

export const dynamic = "force-dynamic";

// Notification bodies are already capped at 140 chars by the DB triggers; trim
// further for email so a preview stays a glance, not a wall of text.
const PREVIEW_CHARS = 90;
function preview(body: string): string {
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > PREVIEW_CHARS ? `${s.slice(0, PREVIEW_CHARS)}…` : s;
}

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
        return `<p style="margin:0 0 14px"><strong>${escapeHtml(title)}</strong>${
          list.length > 1 ? ` · ${list.length} messages` : ""
        }${
          latest.body
            ? `<br/><span style="color:#777">${escapeHtml(preview(latest.body))}</span>`
            : ""
        }</p>`;
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
    const perClient = new Map<
      string,
      { msgs: number; ups: number; latest: string | null }
    >();
    for (const n of group) {
      const name = clientNames.get(n.client_id ?? "") ?? "A client";
      const entry = perClient.get(name) ?? { msgs: 0, ups: 0, latest: null };
      if (n.type === "message") entry.msgs++;
      else entry.ups++;
      // group is ordered oldest first, so the last body seen is the newest.
      if (n.body) entry.latest = n.body;
      perClient.set(name, entry);
    }
    const breakdown = Array.from(perClient.entries())
      .map(([name, c]) => {
        const bits = [
          c.msgs > 0 && `${c.msgs} message${c.msgs === 1 ? "" : "s"}`,
          c.ups > 0 && `${c.ups} upload${c.ups === 1 ? "" : "s"}`,
        ].filter(Boolean);
        return `<p style="margin:0 0 14px"><strong>${escapeHtml(name)}</strong> · ${bits.join(", ")}${
          c.latest
            ? `<br/><span style="color:#777">${escapeHtml(preview(c.latest))}</span>`
            : ""
        }</p>`;
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

  const checkins = await sendCheckins(supabase);
  const assistant = await sendAssistantDigests(supabase);

  return Response.json({ processed: notes.length, sent, nudged, checkins, assistant });
}

/** How late a check-in may go out before it is dropped. "How's your first
 *  week going?" a month in reads as a broken robot, not a person. */
const CHECKIN_GRACE_MS = 3 * 86_400_000;

/**
 * The day-3 and day-7 check-ins booked when a lead is won (0056).
 *
 * Each row is CLAIMED before it is sent, by setting sent_at on a row where it
 * is still null: an email cannot be taken back, and two overlapping runs that
 * both read the row as due must not both send it. A send that fails hands the
 * claim back so the next run tries again. A database without 0056 has no such
 * table and the read simply returns nothing.
 */
async function sendCheckins(supabase: ReturnType<typeof createAdminSupabase>): Promise<number> {
  const now = Date.now();
  const { data } = await supabase
    .from("scheduled_emails")
    .select("id, client_id, recipient_user_id, to_email, kind, send_after")
    .is("sent_at", null)
    .is("cancelled_at", null)
    .lte("send_after", new Date(now).toISOString())
    .order("send_after", { ascending: true })
    .limit(20);
  const due =
    (data as
      | { id: string; client_id: string | null; recipient_user_id: string | null; to_email: string; kind: string; send_after: string }[]
      | null) ?? [];
  const origin = (process.env.NEXT_PUBLIC_APP_URL || `https://${HARTWELL.site}`).replace(/\/$/, "");
  let count = 0;

  for (const row of due) {
    const cancel = () =>
      supabase.from("scheduled_emails").update({ cancelled_at: new Date().toISOString() }).eq("id", row.id);
    if (now - new Date(row.send_after).getTime() > CHECKIN_GRACE_MS) {
      await cancel();
      continue;
    }
    // Still on the account? Someone removed since day one gets nothing.
    const { data: cu } = await supabase
      .from("client_users")
      .select("full_name")
      .eq("clerk_user_id", row.recipient_user_id ?? "")
      .eq("client_id", row.client_id ?? "")
      .maybeSingle();
    if (!cu) {
      await cancel();
      continue;
    }
    const first = (cu as { full_name: string | null }).full_name?.trim().split(/\s+/)[0] || "there";

    let mail: { subject: string; html: string } | null = null;
    if (row.kind === "welcome_day3") {
      const { data: ob } = await supabase.from("onboarding").select("status").eq("client_id", row.client_id ?? "").maybeSingle();
      mail = dayThreeEmail({ origin, first, onboardingDone: (ob as { status: string } | null)?.status === "submitted" });
    } else if (row.kind === "welcome_day7") {
      mail = daySevenEmail({ origin, first });
    }
    if (!mail) {
      await cancel();
      continue;
    }

    const { data: claimed } = await supabase
      .from("scheduled_emails")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("sent_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const res = await sendEmail({ to: row.to_email, subject: mail.subject, html: mail.html, ref: { kind: "other", id: row.client_id ?? row.id } });
    if (res.error || res.skipped) {
      await supabase.from("scheduled_emails").update({ sent_at: null }).eq("id", row.id);
      continue;
    }
    count++;
  }
  return count;
}

/**
 * The portal assistant (0059): one email to Kyle per conversation, once it has
 * been quiet for ten minutes, with every question and every answer. Claimed
 * before sending, like the check-ins, and handed back if the send fails. A
 * question asked after the email starts a new conversation (see
 * /api/assistant), so nothing is emailed twice.
 */
async function sendAssistantDigests(supabase: ReturnType<typeof createAdminSupabase>): Promise<number> {
  const { data, error } = await supabase
    .from("assistant_conversations")
    .select("id, client_id, user_id, started_at, last_message_at, handed_off, message_count")
    .is("emailed_at", null)
    .gt("message_count", 0)
    .lt("last_message_at", new Date(Date.now() - QUIET_BEFORE_EMAIL_MS).toISOString())
    .order("last_message_at", { ascending: true })
    .limit(20);
  if (error) return 0; // 0059 not run yet
  const origin = (process.env.NEXT_PUBLIC_APP_URL || `https://${HARTWELL.site}`).replace(/\/$/, "");
  let count = 0;
  for (const conv of (data as Omit<Transcript, "messages">[] | null) ?? []) {
    const { data: claimed } = await supabase
      .from("assistant_conversations")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", conv.id)
      .is("emailed_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const [{ data: msgs }, { data: client }, { data: person }] = await Promise.all([
      supabase.from("assistant_messages").select("role, content, handed_off, created_at").eq("conversation_id", conv.id).order("created_at"),
      supabase.from("clients").select("business_name").eq("id", conv.client_id).maybeSingle(),
      supabase.from("client_users").select("full_name, email").eq("clerk_user_id", conv.user_id).maybeSingle(),
    ]);
    const messages = (msgs as Transcript["messages"] | null) ?? [];
    if (!messages.length) continue;
    const p = person as { full_name: string | null; email: string | null } | null;
    const mail = digestEmail(origin, { ...conv, messages }, (client as { business_name: string } | null)?.business_name ?? "A client", p?.full_name || p?.email || "A client");
    const res = await sendEmail({ to: HARTWELL.email, subject: mail.subject, html: mail.html, ref: { kind: "other", id: conv.client_id } });
    if (res.error || res.skipped) {
      await supabase.from("assistant_conversations").update({ emailed_at: null }).eq("id", conv.id);
      continue;
    }
    count++;
  }
  return count;
}
