"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { outreachEnabled } from "@/lib/outreach/flag";
import { normaliseEmail } from "@/lib/outreach/normalise";
import { MAX_FIRST_EMAILS_A_DAY } from "@/lib/outreach/limits";
import { disconnectGmail, gmailAccessToken } from "@/lib/outreach/gmail-access";
import { buildMessage, newMessageId, sendRaw } from "@/lib/outreach/gmail";
import { renderMessages, type TemplateText } from "@/lib/outreach/render";
import type { DraperSettings } from "@/lib/outreach/types";

/** Draper's sender controls (Stage 5). Every one checks the flag and an admin first. */
async function guard() {
  if (!outreachEnabled()) throw new Error("Not found");
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return session;
}

type Result = { ok: true } | { ok: false; message: string };

export interface SettingsInput {
  master_on: boolean;
  test_mode: boolean;
  test_inboxes: string;
  daily_first_emails: number;
  window_start: string;
  window_end: string;
  gap_min_minutes: number;
  gap_max_minutes: number;
  stop_window_minutes: number;
  pause_from: string;
  pause_to: string;
  opt_out_line: "A" | "B";
}

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * Settings are versioned: a save is a new row, the old one is kept, and every
 * send records the version in force. The database refuses a slider past 25
 * as well, and no setting can raise the hard ceilings in limits.ts.
 */
export async function saveSettings(input: SettingsInput, note: string): Promise<Result> {
  const session = await guard();
  const inboxes = input.test_inboxes
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (inboxes.length > 5) return { ok: false, message: "Five test inboxes at most." };
  const bad = inboxes.find((e) => !normaliseEmail(e));
  if (bad) return { ok: false, message: `"${bad}" isn't an email address.` };
  const daily = Math.floor(Number(input.daily_first_emails));
  if (!(daily >= 1 && daily <= MAX_FIRST_EMAILS_A_DAY)) return { ok: false, message: `The daily number is 1 to ${MAX_FIRST_EMAILS_A_DAY}.` };
  if (!TIME.test(input.window_start) || !TIME.test(input.window_end)) return { ok: false, message: "Times are HH:MM, like 09:30." };
  if (!(input.window_start >= "07:00" && input.window_end <= "18:00" && input.window_start < input.window_end)) {
    return { ok: false, message: "The send window sits between 7am and 6pm, and starts before it ends." };
  }
  const gMin = Math.floor(Number(input.gap_min_minutes));
  const gMax = Math.floor(Number(input.gap_max_minutes));
  if (!(gMin >= 10 && gMin <= 120 && gMax >= gMin && gMax <= 180)) {
    return { ok: false, message: "The shortest gap is 10 to 120 minutes, and the longest is no shorter than it." };
  }
  const stop = Math.floor(Number(input.stop_window_minutes));
  if (!(stop >= 0 && stop <= 300)) return { ok: false, message: "The stop window is 0 to 300 minutes." };
  const from = input.pause_from.trim() || null;
  const to = input.pause_to.trim() || null;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to)) || (from && to && from > to)) {
    return { ok: false, message: "Pause dates are a start and an end, in order." };
  }
  if (input.test_mode && inboxes.length === 0) return { ok: false, message: "Test mode needs at least one test inbox." };

  const db = await createServerSupabase();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: cur } = await db.from("outreach_settings").select("*").order("version", { ascending: false }).limit(1).single();
    const prev = cur as DraperSettings;
    const { error } = await db.from("outreach_settings").insert({
      version: prev.version + 1,
      master_on: !!input.master_on,
      test_mode: !!input.test_mode,
      test_inboxes: inboxes,
      daily_first_emails: daily,
      window_start: input.window_start,
      window_end: input.window_end,
      gap_min_minutes: gMin,
      gap_max_minutes: gMax,
      stop_window_minutes: stop,
      pause_from: from,
      pause_to: to,
      opt_out_line: input.opt_out_line === "B" ? "B" : "A",
      client_radius_km: prev.client_radius_km,
      never_list: prev.never_list,
      exclusion_categories: prev.exclusion_categories,
      note: note.slice(0, 300) || null,
      created_by: session.clerkUserId,
    });
    if (!error) {
      await db.from("outreach_change_log").insert({ what: `Settings v${prev.version + 1}: ${note || "saved"}`, changed_by: session.clerkUserId });
      revalidatePath("/admin/outreach");
      return { ok: true };
    }
    if (error.code !== "23505") return { ok: false, message: error.message };
  }
  return { ok: false, message: "Someone else saved at the same moment. Try again." };
}

/** Pause all: nothing sends until it's switched back. */
export async function setPaused(paused: boolean): Promise<Result> {
  await guard();
  const db = await createServerSupabase();
  const { error } = await db
    .from("outreach_state")
    .update(
      paused
        ? { paused: true, paused_by: "kyle", paused_reason: "Paused by Kyle", paused_at: new Date().toISOString() }
        : { paused: false, paused_by: null, paused_reason: null, paused_at: null },
    )
    .eq("id", true);
  if (error) return { ok: false, message: error.message };
  await db.from("outreach_events").insert({ kind: paused ? "paused" : "resumed", actor: "kyle" });
  revalidatePath("/admin/outreach");
  return { ok: true };
}

/** "Don't send": a first email takes its follow-up with it. */
export async function dontSend(messageId: string): Promise<Result> {
  await guard();
  const db = await createServerSupabase();
  const { data: m } = await db.from("outreach_messages").select("id, prospect_id, kind, status").eq("id", messageId).maybeSingle();
  const msg = m as { id: string; prospect_id: string; kind: string; status: string } | null;
  if (!msg) return { ok: false, message: "That message isn't there." };
  if (!["awaiting_confirmation", "queued"].includes(msg.status)) return { ok: false, message: `It's ${msg.status} already.` };
  const q = db.from("outreach_messages").update({ status: "cancelled", drop_reason: "Kyle: don't send" }).in("status", ["awaiting_confirmation", "queued"]);
  const { error } = msg.kind === "first" ? await q.eq("prospect_id", msg.prospect_id) : await q.eq("id", msg.id);
  if (error) return { ok: false, message: error.message };
  if (msg.kind === "first") await db.from("outreach_prospects").update({ status: "closed" }).eq("id", msg.prospect_id);
  await db.from("outreach_events").insert({ prospect_id: msg.prospect_id, message_id: msg.id, kind: "cancelled", actor: "kyle", detail: { reason: "Don't send" } });
  revalidatePath("/admin/outreach");
  return { ok: true };
}

/** Approve a first email held by a lane with approval on. */
export async function approveMessage(messageId: string): Promise<Result> {
  await guard();
  const db = await createServerSupabase();
  const { data, error } = await db
    .from("outreach_messages")
    .update({ approved_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("kind", "first")
    .eq("needs_approval", true)
    .in("status", ["awaiting_confirmation", "queued"])
    .select("prospect_id");
  if (error) return { ok: false, message: error.message };
  const row = (data as { prospect_id: string }[] | null)?.[0];
  if (!row) return { ok: false, message: "Nothing to approve there." };
  await db.from("outreach_events").insert({ prospect_id: row.prospect_id, message_id: messageId, kind: "approved", actor: "kyle" });
  revalidatePath("/admin/outreach");
  return { ok: true };
}

/** The "Checked" tick on a "Check these" email. It sends on schedule either way. */
export async function markChecked(messageId: string): Promise<Result> {
  await guard();
  const db = await createServerSupabase();
  const { data, error } = await db
    .from("outreach_messages")
    .update({ checked_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("past_twelve", true)
    .select("prospect_id");
  if (error) return { ok: false, message: error.message };
  const row = (data as { prospect_id: string }[] | null)?.[0];
  if (row) await db.from("outreach_events").insert({ prospect_id: row.prospect_id, message_id: messageId, kind: "checked", actor: "kyle" });
  revalidatePath("/admin/outreach");
  return { ok: true };
}

export async function disconnectGmailAction(): Promise<Result> {
  await guard();
  await disconnectGmail(createAdminSupabase());
  revalidatePath("/admin/outreach");
  return { ok: true };
}

/**
 * Send a test pair to the first test inbox: the reference email from Kyle's
 * brief, then its follow-up threaded under it, as Draper would send them.
 * Checks the Gmail connection, the From name, plain text, spacing and
 * threading. Records nothing against any business.
 */
export async function sendTestPair(): Promise<Result & { to?: string }> {
  const session = await guard();
  const admin = createAdminSupabase();
  const { data: cur } = await admin.from("outreach_settings").select("*").order("version", { ascending: false }).limit(1).single();
  const s = cur as DraperSettings;
  const to = s.test_inboxes[0];
  if (!to) return { ok: false, message: "Add a test inbox in Settings first." };
  const { data: lane } = await admin.from("outreach_lanes").select("template_version").eq("active", true).maybeSingle();
  const { data: t } = await admin
    .from("outreach_templates")
    .select("*")
    .eq("version", (lane as { template_version: number } | null)?.template_version ?? 1)
    .single();
  const r = renderMessages(t as TemplateText, {
    pageName: "canopy",
    firstName: "Sam",
    otherFaults: 2,
    optOut: s.opt_out_line,
    slots: {
      finding:
        "We were looking at 4WD fit-out shops around the Sunshine Coast on Tuesday and had a look at your site. On a phone, your canopy page took a little over six seconds to show anything on Google's own speed test.",
      why_and_fix:
        "Your site has Google's ad tracking on it, so some of those visits are probably paid clicks. Plenty of people on a phone won't wait that long, so it'd be worth getting that page loading faster before putting more into ads.",
      second_finding: "Your contact page, in your main menu, showed an error page when we checked it.",
    },
  });
  if (r.problems.length) return { ok: false, message: r.problems.join(" ") };
  const token = await gmailAccessToken(admin);
  if ("error" in token) return { ok: false, message: token.error };
  try {
    const firstId = newMessageId();
    const first = await sendRaw(token.token, buildMessage({ to, subject: `[Test] ${r.first.subject}`, body: r.first.body, messageId: firstId }));
    await sendRaw(
      token.token,
      buildMessage({ to, subject: `Re: [Test] ${r.first.subject}`, body: r.followUp.body, messageId: newMessageId(), inReplyTo: firstId }),
      first.threadId,
    );
    await admin.from("outreach_change_log").insert({ what: `Test pair sent to ${to}`, why: "Checking the Gmail connection", changed_by: session.clerkUserId });
    return { ok: true, to };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
