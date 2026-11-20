import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAdmins } from "@/lib/notify";
import { checkBusiness, recordFingerprints } from "./check.ts";
import { businessKeys } from "./normalise.ts";
import { measureSite } from "./measure.ts";
import { storeMeasurement } from "./store.ts";
import { confirmedFaults } from "./measure-rules.ts";
import { firstEmailCap, firstEmailsToday, CHECK_THESE_AFTER } from "./limits.ts";
import {
  calendar,
  CHECK_THESE_NOT_BEFORE,
  followUpDay,
  melbourneDate,
  melbourneTime,
  nextSendingDay,
  planDay,
  recipientFor,
  sendingDay,
  SUMMARY_AT,
  type Calendar,
} from "./schedule.ts";
import { fillTokens } from "./tokens.ts";
import { renderFollowUp, renderMessages, type TemplateText } from "./render.ts";
import { gmailAccessToken } from "./gmail-access.ts";
import { buildMessage, findByMessageId, newMessageId, sendRaw } from "./gmail.ts";
import { FAULT_LABEL, type Fault } from "./rules.ts";
import type { DraperSettings } from "./types.ts";

/**
 * Draper's sender (Stage 5): the tick cron-job.org calls every five minutes
 * (/api/cron/outreach-tick). Each call does at most one heavy thing, so it
 * fits a 60-second function: a measurement takes 15 to 40 seconds.
 *
 * In order:
 *   1. expire queued first emails a lane held for approval more than 3 days;
 *   2. at 8am on a sending day, fix the day's queue and send Kyle the summary;
 *   3. send the next message that is due, after the no-repeat check and a
 *      fresh measurement of its fault;
 *   4. otherwise confirm one submitted draft: measure its faults again an
 *      hour or more after the first run, then queue it or drop it.
 *
 * Every send is CLAIMED first (status queued -> sending) so two ticks can't
 * send one message, and a send that errored is checked with Gmail before it
 * is tried again, so nothing is ever sent twice.
 */

type Msg = {
  id: string;
  prospect_id: string;
  kind: "first" | "follow_up";
  subject: string;
  body: string;
  slots: Record<string, string | null>;
  fault: Fault;
  status: string;
  needs_approval: boolean;
  approved_at: string | null;
  past_twelve: boolean;
  send_on: string | null;
  scheduled_for: string | null;
  queued_at: string | null;
  sent_at: string | null;
  gmail_thread_id: string | null;
  rfc_message_id: string | null;
  template_version: number;
  send_attempts: number;
  created_at: string;
};

type Prospect = {
  id: string;
  business_name: string | null;
  domain: string | null;
  abn: string | null;
  phone: string | null;
  postcode: string | null;
  state: string | null;
  services: string[];
  status: string;
};

const MSG_COLS =
  "id, prospect_id, kind, subject, body, slots, fault, status, needs_approval, approved_at, past_twelve, send_on, scheduled_for, queued_at, sent_at, gmail_thread_id, rfc_message_id, template_version, send_attempts, created_at";
const HOUR = 3600_000;
const MAX_ATTEMPTS = 3;

async function latestSettings(db: SupabaseClient): Promise<DraperSettings> {
  const { data, error } = await db.from("outreach_settings").select("*").order("version", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) throw new Error(`Draper's settings couldn't be read: ${error?.message ?? "none"}`);
  return data as DraperSettings;
}

async function event(db: SupabaseClient, prospectId: string, kind: string, detail: Record<string, unknown> = {}, messageId?: string) {
  await db.from("outreach_events").insert({ prospect_id: prospectId, message_id: messageId ?? null, kind, actor: "pulse", detail });
}

/** Drop a first email and its follow-up, or cancel a follow-up alone. */
async function dropMessage(db: SupabaseClient, m: Msg, reason: string) {
  if (m.kind === "first") {
    await db
      .from("outreach_messages")
      .update({ status: "dropped", drop_reason: reason })
      .eq("prospect_id", m.prospect_id)
      .in("status", ["awaiting_confirmation", "queued", "sending"]);
    await db.from("outreach_prospects").update({ status: "dropped", drop_reason: reason }).eq("id", m.prospect_id).neq("status", "sent");
  } else {
    await db.from("outreach_messages").update({ status: "cancelled", drop_reason: reason }).eq("id", m.id);
  }
  await event(db, m.prospect_id, m.kind === "first" ? "dropped" : "cancelled", { reason }, m.id);
}

/** Back in the queue after a problem, a little later; failed after three tries. */
async function putBack(db: SupabaseClient, m: Msg, error: string, now: Date) {
  const attempts = m.send_attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db.from("outreach_messages").update({ status: "failed", drop_reason: error, send_attempts: attempts, send_error: error }).eq("id", m.id);
    await event(db, m.prospect_id, "cancelled", { reason: `Failed ${attempts} times: ${error}` }, m.id);
    await notifyAdmins(null, "outreach", {
      title: "Draper couldn't send an email",
      body: `After ${attempts} tries: ${error}`,
      link: "/admin/outreach",
    });
    return;
  }
  await db
    .from("outreach_messages")
    .update({ status: "queued", send_attempts: attempts, send_error: error, scheduled_for: new Date(now.getTime() + 15 * 60_000).toISOString() })
    .eq("id", m.id);
}

// ---------- 1. approvals that ran out ----------

async function expireApprovals(db: SupabaseClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 3 * 24 * HOUR).toISOString();
  const { data } = await db
    .from("outreach_messages")
    .update({ status: "expired", drop_reason: "Not approved within 3 days" })
    .eq("kind", "first")
    .eq("status", "queued")
    .eq("needs_approval", true)
    .is("approved_at", null)
    .lt("queued_at", cutoff)
    .select("prospect_id");
  const ids = ((data as { prospect_id: string }[] | null) ?? []).map((r) => r.prospect_id);
  if (ids.length) {
    await db.from("outreach_messages").update({ status: "expired", drop_reason: "Its first email wasn't approved" }).in("prospect_id", ids).eq("kind", "follow_up").eq("status", "queued");
  }
  return ids.length;
}

// ---------- 2. the day's queue, fixed at 8am ----------

/** Sending days already used by real first emails, for the warm-up ramp. */
async function sendingDaysDone(db: SupabaseClient): Promise<number> {
  const { data } = await db.from("outreach_messages").select("sent_at").eq("kind", "first").eq("test_mode", false).not("sent_at", "is", null);
  return new Set(((data as { sent_at: string }[] | null) ?? []).map((r) => melbourneDate(new Date(r.sent_at)))).size;
}

async function fixQueue(db: SupabaseClient, s: DraperSettings, cal: Calendar, now: Date): Promise<string> {
  const today = melbourneDate(now);
  const [{ data: fuRows }, { data: firstRows }] = await Promise.all([
    db.from("outreach_messages").select(MSG_COLS).eq("kind", "follow_up").eq("status", "queued").not("send_on", "is", null).lte("send_on", today),
    db.from("outreach_messages").select(MSG_COLS).eq("kind", "first").eq("status", "queued").or(`send_on.is.null,send_on.lte.${today}`).order("queued_at"),
  ]);
  const fus = (fuRows as Msg[] | null) ?? [];
  const firsts = ((firstRows as Msg[] | null) ?? []).filter((m) => !m.needs_approval || m.approved_at);
  const ids = [...new Set([...fus, ...firsts].map((m) => m.prospect_id))];
  const { data: pRows } = ids.length ? await db.from("outreach_prospects").select("id, business_name, state").in("id", ids) : { data: [] };
  const prospects = new Map(((pRows as { id: string; business_name: string | null; state: string | null }[] | null) ?? []).map((p) => [p.id, p]));
  // Not today if it's a holiday where they are.
  const okToday = (m: Msg) => sendingDay(today, prospects.get(m.prospect_id)?.state ?? null, cal).ok;
  const fusToday = fus.filter(okToday);
  const firstsToday = firsts.filter(okToday);

  const cap = firstEmailsToday(firstEmailCap(s.daily_first_emails, await sendingDaysDone(db)), fusToday.length);
  const take = firstsToday.slice(0, cap);
  const items = [
    ...take.slice(0, CHECK_THESE_AFTER).map((m) => ({ id: m.id })),
    ...fusToday.map((m) => ({ id: m.id })),
    ...take.slice(CHECK_THESE_AFTER).map((m) => ({ id: m.id, notBefore: CHECK_THESE_NOT_BEFORE })),
  ];
  const plan = planDay({
    date: today,
    windowStart: s.window_start.slice(0, 5),
    windowEnd: s.window_end.slice(0, 5),
    gapMin: s.gap_min_minutes,
    gapMax: s.gap_max_minutes,
    stopWindowMinutes: s.stop_window_minutes,
    fixedAt: melbourneTime(now),
    items,
    random: Math.random,
  });
  const pastTwelve = new Set(take.slice(CHECK_THESE_AFTER).map((m) => m.id));
  for (const t of plan.times) {
    await db
      .from("outreach_messages")
      .update({ scheduled_for: t.at.toISOString(), send_on: today, past_twelve: pastTwelve.has(t.id) })
      .eq("id", t.id);
  }
  // Everything not sent today waits for the next sending day's fix.
  const planned = new Set(plan.times.map((t) => t.id));
  const later = [...fus, ...firsts].filter((m) => !planned.has(m.id)).map((m) => m.id);
  const next = nextSendingDay(today, null, cal);
  if (later.length) await db.from("outreach_messages").update({ send_on: next, scheduled_for: null }).in("id", later);

  await db.from("outreach_state").update({ queue_fixed_on: today }).eq("id", true);

  if (plan.times.length > 0) {
    const byId = new Map([...fus, ...firsts].map((m) => [m.id, m]));
    const mode = s.test_mode ? " (test mode: all to your test inboxes)" : "";
    const lines = plan.times.map((t) => {
      const m = byId.get(t.id)!;
      const who = prospects.get(m.prospect_id)?.business_name ?? "A business";
      const at = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit" }).format(t.at);
      return `${at}  ${who}: ${m.subject}${m.kind === "follow_up" ? " (follow-up)" : ""}${pastTwelve.has(t.id) ? " (check these)" : ""}`;
    });
    const stop = s.stop_window_minutes ? ` Nothing goes for ${s.stop_window_minutes} minutes: tap Don't send on any, or pause all.` : "";
    const nFirst = take.filter((m) => planned.has(m.id)).length;
    const nFollow = fusToday.filter((m) => planned.has(m.id)).length;
    await notifyAdmins(null, "outreach", {
      title: `Draper today: ${nFirst} first email${nFirst === 1 ? "" : "s"}, ${nFollow} follow-up${nFollow === 1 ? "" : "s"}${mode}`,
      body: `${lines.join("\n")}${stop}`,
      link: "/admin/outreach",
    });
  }
  return `Queue fixed for ${today}: ${plan.times.length} planned, ${later.length} for a later day`;
}

// ---------- 3. sending ----------

async function sendNext(db: SupabaseClient, s: DraperSettings, cal: Calendar, now: Date): Promise<string | null> {
  const today = melbourneDate(now);
  const { data } = await db
    .from("outreach_messages")
    .select(MSG_COLS)
    .eq("status", "queued")
    .eq("send_on", today)
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for")
    .limit(1);
  const due = (data as Msg[] | null)?.[0];
  if (!due) return null;
  if (due.kind === "first" && due.needs_approval && !due.approved_at) return null;
  // Claim it: only one tick gets to send it.
  const { data: claimed } = await db.from("outreach_messages").update({ status: "sending" }).eq("id", due.id).eq("status", "queued").select("id");
  if (!claimed?.length) return "Another run took that message";
  try {
    return await sendClaimed(db, due, s, cal, now);
  } catch (e) {
    await putBack(db, due, e instanceof Error ? e.message : String(e), now);
    return `Send failed and was put back: ${String(e)}`;
  }
}

async function sendClaimed(db: SupabaseClient, m: Msg, s: DraperSettings, cal: Calendar, now: Date): Promise<string> {
  const [{ data: pRow }, { data: cRow }, { data: firstRow }] = await Promise.all([
    db.from("outreach_prospects").select("id, business_name, domain, abn, phone, postcode, state, services, status").eq("id", m.prospect_id).single(),
    db.from("outreach_contacts").select("email, first_name").eq("prospect_id", m.prospect_id).maybeSingle(),
    m.kind === "follow_up"
      ? db.from("outreach_messages").select(`${MSG_COLS}, sent_to, test_mode`).eq("prospect_id", m.prospect_id).eq("kind", "first").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const p = pRow as Prospect;
  const contact = cRow as { email: string | null; first_name: string | null } | null;
  const first = firstRow as Msg | null;
  if (!contact?.email) {
    await dropMessage(db, m, "No contact address on file");
    return "Dropped: no contact address";
  }
  if (m.kind === "follow_up" && (!first?.gmail_thread_id || !first.rfc_message_id || first.status !== "sent")) {
    await dropMessage(db, m, "Its first email isn't on record as sent");
    return "Follow-up cancelled: no sent first email to thread it to";
  }

  // A follow-up goes wherever its first email went: a test pair stays in one
  // test inbox, and a business that never got a first email (it went to a
  // test inbox) never gets a follow-up. Each business keeps to one test inbox.
  const firstSent = first as (Msg & { sent_to?: string | null; test_mode?: boolean | null }) | null;
  const pick = [...p.id].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const rcpt =
    m.kind === "follow_up" && firstSent?.test_mode && firstSent.sent_to
      ? { to: firstSent.sent_to, test: true as const }
      : recipientFor(s, contact.email, pick);
  if ("blocked" in rcpt) {
    await db.from("outreach_messages").update({ status: "queued" }).eq("id", m.id);
    return `Not sending: ${rcpt.blocked}`;
  }

  // The no-repeat rule, again, just before it goes.
  const verdict = await checkBusiness(
    db,
    { domain: p.domain, name: p.business_name, abn: p.abn, email: contact.email, phone: p.phone, postcode: p.postcode, services: p.services ?? [] },
    { exceptProspectId: p.id, exceptFingerprintSource: `prospect:${p.id}` },
  );
  if (!verdict.allowed) {
    const why = verdict.problem ?? verdict.blocks.map((b) => b.label).join("; ");
    await dropMessage(db, m, `Blocked just before sending: ${why}`);
    return `Dropped before sending: ${why}`;
  }

  // The fault, measured again now. Fixed: dropped. Couldn't check: later.
  const { data: claimRows } = await db.from("outreach_claims").select("measurement_id").eq("message_id", m.id).eq("fault", m.fault).limit(1);
  const claimId = (claimRows as { measurement_id: string }[] | null)?.[0]?.measurement_id;
  const { data: claimed } = claimId ? await db.from("outreach_measurements").select("url").eq("id", claimId).maybeSingle() : { data: null };
  const url = (claimed as { url: string } | null)?.url;
  if (!url) {
    await dropMessage(db, m, "Its claim has no measurement on record");
    return "Dropped: no measurement behind the claim";
  }
  const fresh = await measureSite(url);
  await storeMeasurement(db, p.id, fresh, m.kind === "first" ? "pre_send" : "follow_up").catch(() => null);
  if (fresh.status !== "ok") {
    await putBack(db, m, `Couldn't re-check the page before sending: ${fresh.error ?? fresh.status}`, now);
    return "Put back: the page couldn't be re-checked";
  }
  if (!fresh.faults.includes(m.fault)) {
    await dropMessage(db, m, `"${FAULT_LABEL[m.fault]}" was fixed before it went`);
    return `Dropped: ${FAULT_LABEL[m.fault]} was fixed before sending`;
  }

  // A follow-up carries this morning's figures.
  let body = m.body;
  if (m.kind === "follow_up") {
    const { data: t } = await db.from("outreach_templates").select("*").eq("version", m.template_version).single();
    const filled = fillTokens(m.slots.second_finding ?? "", {
      measuredAt: fresh.measuredAt,
      fcpMs: fresh.psi.fcpMs,
      lcpMs: fresh.psi.lcpMs,
      pageviews: Math.max(0, ...Object.values(fresh.pixelPageViews)),
      brokenPage: m.slots.broken_page_name,
      page: first?.slots.page_name ?? null,
      area: first?.slots.area ?? null,
    });
    if (filled.missing.length) {
      await dropMessage(db, m, `This morning's figures don't back [[${filled.missing.join("]], [[")}]]`);
      return "Follow-up cancelled: this morning's figures didn't hold";
    }
    const r = renderFollowUp(t as TemplateText, { firstName: contact.first_name, optOut: s.opt_out_line, secondFinding: filled.text });
    if (r.problems.length) throw new Error(r.problems.join(" "));
    body = r.body;
  }

  const token = await gmailAccessToken(db);
  if ("error" in token) throw new Error(token.error);
  const rfcId = m.rfc_message_id ?? newMessageId();
  if (!m.rfc_message_id) await db.from("outreach_messages").update({ rfc_message_id: rfcId }).eq("id", m.id);

  // A retry first asks Gmail whether the last try went after all.
  let sent = m.send_attempts > 0 ? await findByMessageId(token.token, rfcId) : null;
  if (!sent) {
    const raw = buildMessage({
      to: rcpt.to,
      subject: m.subject,
      body,
      messageId: rfcId,
      inReplyTo: m.kind === "follow_up" ? first!.rfc_message_id : null,
    });
    sent = await sendRaw(token.token, raw, m.kind === "follow_up" ? first!.gmail_thread_id : null);
  }

  const today = melbourneDate(now);
  await db
    .from("outreach_messages")
    .update({
      status: "sent",
      sent_at: now.toISOString(),
      sent_to: rcpt.to,
      test_mode: rcpt.test,
      gmail_message_id: sent.id,
      gmail_thread_id: sent.threadId,
      settings_version: s.version,
      body,
      send_error: null,
    })
    .eq("id", m.id);
  await event(db, p.id, m.kind === "first" ? "sent" : "followed_up", { to: rcpt.test ? "test inbox" : "business", test: rcpt.test }, m.id);
  await db.from("outreach_prospects").update({ status: m.kind === "first" ? "sent" : "followed_up" }).eq("id", p.id);
  if (m.kind === "first") {
    await db
      .from("outreach_messages")
      .update({ send_on: followUpDay(today, p.state, cal) })
      .eq("prospect_id", p.id)
      .eq("kind", "follow_up")
      .eq("status", "queued");
  }
  // Contacted for real: blocked for good. Test sends reached Kyle, not them.
  if (!rcpt.test) {
    await recordFingerprints(
      db,
      businessKeys({ domain: p.domain, name: p.business_name, abn: p.abn, email: contact.email, phone: p.phone }),
      "contacted",
      `prospect:${p.id}`,
    );
  }
  return `Sent the ${m.kind === "first" ? "first email" : "follow-up"} to ${rcpt.test ? "a test inbox" : p.business_name}`;
}

// ---------- 4. confirming a draft ----------

type Run = { id: string; url: string; status: string; measured_at: string; faults: Fault[]; psi_fcp_ms: number | null; psi_lcp_ms: number | null; pixel_pageviews: Record<string, number>; purpose: string };

async function confirmNext(db: SupabaseClient, s: DraperSettings, cal: Calendar, now: Date): Promise<string | null> {
  const { data } = await db.from("outreach_messages").select(MSG_COLS).eq("kind", "first").eq("status", "awaiting_confirmation").order("created_at").limit(20);
  for (const first of (data as Msg[] | null) ?? []) {
    const [{ data: fuRow }, { data: runRows }] = await Promise.all([
      db.from("outreach_messages").select(MSG_COLS).eq("prospect_id", first.prospect_id).eq("kind", "follow_up").maybeSingle(),
      db.from("outreach_measurements").select("id, url, status, measured_at, faults, psi_fcp_ms, psi_lcp_ms, pixel_pageviews, purpose").eq("prospect_id", first.prospect_id).order("measured_at"),
    ]);
    const followUp = fuRow as Msg | null;
    const runs = (runRows as Run[] | null) ?? [];
    const { data: claimRows } = await db
      .from("outreach_claims")
      .select("message_id, measurement_id, fault")
      .in("message_id", [first.id, ...(followUp ? [followUp.id] : [])]);
    // The fault each email is about, and the run that first showed it.
    const claimFor = (msg: Msg | null) => {
      const c = ((claimRows as { message_id: string; measurement_id: string; fault: Fault }[] | null) ?? []).find((x) => msg && x.message_id === msg.id && x.fault === msg.fault);
      return c ? runs.find((r) => r.id === c.measurement_id) : undefined;
    };
    const targets = [
      { msg: first, run: claimFor(first) },
      ...(followUp ? [{ msg: followUp, run: claimFor(followUp) }] : []),
    ];
    if (targets.some((t) => !t.run)) {
      await dropMessage(db, first, "A claim lost its measurement");
      return "Dropped a draft whose claim lost its measurement";
    }

    // Any page still needing its second run an hour on? Measure one, then stop.
    let waiting = false;
    for (const t of targets) {
      const run = t.run!;
      const later = runs.filter((r) => r.url === run.url && new Date(r.measured_at).getTime() - new Date(run.measured_at).getTime() >= HOUR);
      if (later.some((r) => r.status === "ok")) continue;
      if (now.getTime() - new Date(run.measured_at).getTime() < HOUR) {
        waiting = true;
        continue;
      }
      const lastTry = later[later.length - 1];
      if (later.length >= 3) {
        await dropMessage(db, first, "The page couldn't be checked again to confirm the fault");
        return "Dropped a draft: couldn't confirm the fault";
      }
      if (lastTry && now.getTime() - new Date(lastTry.measured_at).getTime() < 30 * 60_000) {
        waiting = true;
        continue;
      }
      const m = await measureSite(run.url);
      await storeMeasurement(db, first.prospect_id, m, "confirm");
      return `Measured ${run.url} again to confirm a draft`;
    }
    if (waiting) continue;

    // Both runs are in: did each email's fault show on both?
    for (const t of targets) {
      const onPage = runs.filter((r) => r.url === t.run!.url);
      const confirmed = confirmedFaults(onPage.map((r) => ({ measuredAt: r.measured_at, status: r.status as "ok" | "blocked" | "failed", faults: r.faults })));
      if (!confirmed.includes(t.msg.fault)) {
        await dropMessage(db, first, `"${FAULT_LABEL[t.msg.fault]}" didn't show again an hour later`);
        return `Dropped a draft: ${FAULT_LABEL[t.msg.fault]} didn't repeat`;
      }
    }

    // Confirmed. Fill the first email's figures from the lower of the runs.
    const firstRuns = runs.filter((r) => r.url === targets[0].run!.url && r.status === "ok");
    const low = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? Math.min(...v) : null;
    };
    const facts = {
      measuredAt: targets[0].run!.measured_at,
      fcpMs: low(firstRuns.map((r) => r.psi_fcp_ms)),
      lcpMs: low(firstRuns.map((r) => r.psi_lcp_ms)),
      pageviews: low(firstRuns.map((r) => Math.max(0, ...Object.values(r.pixel_pageviews ?? {})))),
      page: first.slots.page_name,
      brokenPage: first.slots.broken_page_name,
      area: first.slots.area,
    };
    const finding = fillTokens(first.slots.finding ?? "", facts);
    const why = fillTokens(first.slots.why_and_fix ?? "", facts);
    if (finding.missing.length || why.missing.length) {
      await dropMessage(db, first, "A figure didn't hold on the second run");
      return "Dropped a draft: a figure didn't hold";
    }
    // Other things on record: faults confirmed on any page, less this email's.
    const urls = [...new Set(runs.map((r) => r.url))];
    const others = new Set(
      urls
        .flatMap((u) => confirmedFaults(runs.filter((r) => r.url === u).map((r) => ({ measuredAt: r.measured_at, status: r.status as "ok" | "blocked" | "failed", faults: r.faults }))))
        .filter((f) => f !== first.fault),
    );
    const [{ data: t }, { data: c }, { data: pRow }] = await Promise.all([
      db.from("outreach_templates").select("*").eq("version", first.template_version).single(),
      db.from("outreach_contacts").select("first_name").eq("prospect_id", first.prospect_id).maybeSingle(),
      db.from("outreach_prospects").select("state").eq("id", first.prospect_id).single(),
    ]);
    const r = renderMessages(t as TemplateText, {
      pageName: first.slots.page_name ?? "",
      firstName: (c as { first_name: string | null } | null)?.first_name ?? null,
      otherFaults: others.size,
      optOut: s.opt_out_line,
      slots: { finding: finding.text, why_and_fix: why.text, second_finding: followUp?.slots.second_finding ?? "" },
    });
    if (r.problems.length) {
      await dropMessage(db, first, r.problems.join(" "));
      return "Dropped a draft: it wouldn't render";
    }
    const stamp = now.toISOString();
    const sendOn = nextSendingDay(melbourneDate(now), (pRow as { state: string | null }).state, cal);
    await db
      .from("outreach_messages")
      .update({ status: "queued", subject: r.first.subject, body: r.first.body, queued_at: stamp, confirmed_at: stamp, send_on: sendOn })
      .eq("id", first.id);
    if (followUp) await db.from("outreach_messages").update({ status: "queued", queued_at: stamp, confirmed_at: stamp, send_on: null }).eq("id", followUp.id);
    await db.from("outreach_prospects").update({ status: "queued" }).eq("id", first.prospect_id);
    await event(db, first.prospect_id, "confirmed", { send_on: sendOn }, first.id);
    await event(db, first.prospect_id, "queued", { send_on: sendOn }, first.id);
    return `Confirmed a draft; queued for ${sendOn ?? "the first day with holiday dates loaded"}`;
  }
  return null;
}

// ---------- the tick ----------

export async function tick(db: SupabaseClient, now = new Date()): Promise<string> {
  const s = await latestSettings(db);
  const { data: st } = await db.from("outreach_state").select("paused, queue_fixed_on").maybeSingle();
  const state = (st as { paused: boolean; queue_fixed_on: string | null } | null) ?? { paused: false, queue_fixed_on: null };
  const cal = calendar(s.pause_from, s.pause_to);
  const today = melbourneDate(now);
  const time = melbourneTime(now);
  const day = sendingDay(today, null, cal);

  const finish = async (note: string) => {
    await db.from("outreach_state").update({ tick_at: now.toISOString(), tick_note: note.slice(0, 500) }).eq("id", true);
    return note;
  };

  const expired = await expireApprovals(db, now);
  if (expired) return finish(`Expired ${expired} unapproved email${expired === 1 ? "" : "s"}`);

  const mode = recipientFor(s, "business@example.invalid", 0);
  const canSend = !state.paused && !("blocked" in mode);
  if (canSend && day.ok && time >= SUMMARY_AT && state.queue_fixed_on !== today) {
    return finish(await fixQueue(db, s, cal, now));
  }
  if (canSend && day.ok && time >= s.window_start.slice(0, 5) && time <= s.window_end.slice(0, 5)) {
    const sent = await sendNext(db, s, cal, now);
    if (sent) return finish(sent);
  }
  const confirmed = await confirmNext(db, s, cal, now);
  if (confirmed) return finish(confirmed);
  const why = state.paused ? "paused" : "blocked" in mode ? mode.blocked : !day.ok ? `today is ${day.reason}` : "nothing due";
  return finish(`Nothing to do (${why})`);
}
