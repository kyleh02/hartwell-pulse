import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAdmins } from "@/lib/notify";
import { businessToday } from "@/lib/business-time";
import { createLeadOp } from "@/lib/pipeline-ops";
import { recordFingerprints } from "./check.ts";
import { businessKeys } from "./normalise.ts";
import { gmailAccessToken } from "./gmail-access.ts";
import { getMessage, listMessageIds, SENDER_EMAIL } from "./gmail.ts";
import { FAULT_LABEL, type Fault } from "./rules.ts";
import {
  autoPauseReason,
  classify,
  DO_NOT_CONTACT,
  gmailThreadUrl,
  isReplyLabel,
  LABEL_TEXT,
  MAKES_LEAD,
  parseMessage,
  WRONG_FACTS_TO_SWITCH_OFF,
  type Incoming,
  type ReplyLabel,
  type SentFirst,
} from "./replies-rules.ts";

/**
 * Replies (Stage 6). The tick calls checkReplies() every ten minutes, paused
 * or not, master switch or not: an opt-out is honoured whatever else is
 * going on. It reads kyle@'s new mail (not Kyle's own), matches each message
 * to the email it answers (by thread, then by our Message-ID, then by the
 * address we wrote to) and acts on it:
 *
 *   bounce         the address is marked bad, the follow-up cancelled, the
 *                  prospect closed;
 *   out-of-office  recorded and ignored (a delayed-delivery notice too);
 *   opt-out        labelled "no thanks" in code, the follow-up cancelled,
 *                  the business on do-not-contact for good, Kyle told;
 *   reply          the follow-up cancelled at once, Kyle told, and it waits
 *                  for his label.
 *
 * After a business's first reply the thread is Kyle's conversation: later
 * messages aren't recorded, except an opt-out, which counts whenever it comes.
 *
 * **A test send never reaches a business**, so nothing that follows from one
 * touches a business either: no do-not-contact entry, no fingerprints, and a
 * lead it makes says [Test] and carries the test inbox.
 *
 * Nothing here replies to anyone. Kyle answers every reply himself.
 */

const REPLY_CHECK_MINUTES = 10;
const OVERLAP_MS = 60 * 60_000;
const MAX_READ = 25;

type SentMsg = {
  id: string;
  prospect_id: string;
  kind: "first" | "follow_up";
  fault: Fault | null;
  sent_at: string;
  sent_to: string | null;
  test_mode: boolean | null;
  gmail_thread_id: string | null;
};
const SENT_COLS = "id, prospect_id, kind, fault, sent_at, sent_to, test_mode, gmail_thread_id";

type ProspectRow = {
  id: string;
  business_name: string | null;
  domain: string | null;
  website_url: string | null;
  abn: string | null;
  phone: string | null;
  status: string;
};
const PROSPECT_COLS = "id, business_name, domain, website_url, abn, phone, status";

type Actor = "pulse" | "kyle" | "claude";

async function event(db: SupabaseClient, prospectId: string | null, kind: string, detail: Record<string, unknown>, messageId: string | null = null, actor: Actor = "pulse") {
  await db.from("outreach_events").insert({ prospect_id: prospectId, message_id: messageId, kind, actor, detail });
}

/** 0066's two state columns, read apart so a database without them still works. */
async function replyState(db: SupabaseClient): Promise<{ checkedAt: string | null; rulesSince: string | null }> {
  const { data, error } = await db.from("outreach_state").select("replies_checked_at, auto_rules_since").maybeSingle();
  if (error || !data) return { checkedAt: null, rulesSince: null };
  const d = data as { replies_checked_at: string | null; auto_rules_since: string | null };
  return { checkedAt: d.replies_checked_at, rulesSince: d.auto_rules_since };
}

async function markChecked(db: SupabaseClient, at: Date) {
  await db.from("outreach_state").update({ replies_checked_at: at.toISOString() }).eq("id", true);
}

/** Our own fixed lines (template text and both opt-out lines), so quoting them back never reads as theirs. */
async function ourLines(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("outreach_templates").select("first_body, followup_body, opt_out_a, opt_out_b");
  const lines = new Set<string>();
  for (const t of (data as { first_body: string; followup_body: string; opt_out_a: string; opt_out_b: string }[] | null) ?? []) {
    lines.add(t.opt_out_a);
    lines.add(t.opt_out_b);
    for (const body of [t.first_body, t.followup_body]) {
      for (const l of body.split("\n")) {
        const x = l.trim();
        if (x.length >= 12 && !/\{[a-z_]+\}/.test(x)) lines.add(x);
      }
    }
  }
  return [...lines];
}

/** The email a message answers: the latest of ours sent before it, in its thread, by Message-ID, or to its sender. */
async function matchSent(db: SupabaseClient, inc: Incoming): Promise<SentMsg | null> {
  const before = new Date(inc.receivedAt).getTime() + 60_000;
  const pick = (rows: SentMsg[] | null) => {
    const r = (rows ?? []).filter((m) => m.sent_at).sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
    return r.find((m) => new Date(m.sent_at).getTime() <= before) ?? r[r.length - 1] ?? null;
  };
  const { data: byThread } = await db.from("outreach_messages").select(SENT_COLS).eq("gmail_thread_id", inc.threadId).eq("status", "sent");
  const t = pick(byThread as SentMsg[] | null);
  if (t) return t;
  const ours = inc.messageIds.filter((id) => /@hartwelldigital\.com>$/i.test(id));
  if (ours.length) {
    const { data: byId } = await db.from("outreach_messages").select(SENT_COLS).in("rfc_message_id", ours).eq("status", "sent");
    const m = pick(byId as SentMsg[] | null);
    if (m) return m;
  }
  if (inc.fromEmail) {
    const { data: cs } = await db.from("outreach_contacts").select("prospect_id").eq("email_lower", inc.fromEmail).limit(5);
    const ids = ((cs as { prospect_id: string }[] | null) ?? []).map((c) => c.prospect_id);
    if (ids.length) {
      const { data: byAddr } = await db.from("outreach_messages").select(SENT_COLS).in("prospect_id", ids).eq("status", "sent").eq("test_mode", false);
      return pick(byAddr as SentMsg[] | null);
    }
  }
  return null;
}

async function cancelFollowUp(db: SupabaseClient, prospectId: string, reason: string) {
  const { data } = await db
    .from("outreach_messages")
    .update({ status: "cancelled", drop_reason: reason })
    .eq("prospect_id", prospectId)
    .eq("kind", "follow_up")
    .in("status", ["awaiting_confirmation", "queued"])
    .select("id");
  const id = (data as { id: string }[] | null)?.[0]?.id;
  if (id) await event(db, prospectId, "cancelled", { reason }, id);
}

/** A reply row, or null if another run recorded this Gmail message first. */
async function insertReply(db: SupabaseClient, row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await db.from("outreach_replies").insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`A reply couldn't be saved: ${error.message}`);
  }
  return (data as { id: string }).id;
}

/** Closed, and for "no thanks" or a complaint on a real send, on do-not-contact and fingerprinted for good. */
async function closeAndSuppress(db: SupabaseClient, p: ProspectRow, label: ReplyLabel, sent: SentMsg | null, actor: Actor) {
  await db.from("outreach_prospects").update({ status: "closed", later_on: null }).eq("id", p.id);
  if (sent?.test_mode || !DO_NOT_CONTACT.has(label)) return;
  const { data: c } = await db.from("outreach_contacts").select("email, first_name").eq("prospect_id", p.id).maybeSingle();
  const contact = c as { email: string | null; first_name: string | null } | null;
  const email = contact?.email?.trim() || null;
  const reason = label === "complaint" ? "Complained about an outreach email" : "Said no to an outreach email";
  const { data: already } = email ? await db.from("do_not_contact").select("id").eq("email_lower", email.toLowerCase()).maybeSingle() : { data: null };
  if (!already) {
    await db.from("do_not_contact").insert({
      email,
      name: contact?.first_name ?? null,
      business: p.business_name,
      website: p.website_url ?? p.domain,
      abn: p.abn,
      phone: p.phone,
      reason,
      source: "outreach",
    });
  }
  await recordFingerprints(
    db,
    businessKeys({ domain: p.domain, name: p.business_name, abn: p.abn, email, phone: p.phone }),
    "opted_out",
    `prospect:${p.id}`,
  );
  await event(db, p.id, "suppressed", { label }, sent?.id ?? null, actor);
}

type Handled = "bounce" | "auto" | "opt_out" | "reply" | "kyle's";

async function handleIncoming(db: SupabaseClient, inc: Incoming, sent: SentMsg, lines: string[], now: Date): Promise<Handled | null> {
  const c = classify(inc, lines);
  const test = !!sent.test_mode;
  const { data: pRow } = await db.from("outreach_prospects").select(PROSPECT_COLS).eq("id", sent.prospect_id).single();
  const p = pRow as ProspectRow;
  const name = p.business_name ?? "A business";
  const tag = test ? "[Test] " : "";
  const base = {
    prospect_id: p.id,
    message_id: sent.id,
    gmail_message_id: inc.id,
    received_at: inc.receivedAt,
    from_email: inc.fromEmail.slice(0, 320) || null,
  };

  if (c.kind === "delay" || c.kind === "auto_reply") {
    await insertReply(db, { ...base, kind: "auto_reply", quote: c.quote });
    return "auto";
  }

  if (c.kind === "bounce") {
    if (!(await insertReply(db, { ...base, kind: "bounce", quote: c.quote }))) return null;
    await db.from("outreach_contacts").update({ bounced_at: now.toISOString() }).eq("prospect_id", p.id);
    await cancelFollowUp(db, p.id, "The email bounced");
    if (["sent", "followed_up"].includes(p.status)) await db.from("outreach_prospects").update({ status: "closed" }).eq("id", p.id);
    await event(db, p.id, "bounced", { test }, sent.id);
    await notifyAdmins(
      null,
      "outreach",
      { title: `${tag}Bounced: ${name}`, body: "The address is marked bad and the follow-up is cancelled.", link: "/admin/outreach?tab=replies" },
      "in_portal",
    );
    return "bounce";
  }

  // A person wrote.
  const { data: prior } = await db.from("outreach_replies").select("kind").eq("prospect_id", p.id).in("kind", ["reply", "opt_out"]);
  const priorKinds = ((prior as { kind: string }[] | null) ?? []).map((r) => r.kind);

  if (c.kind === "opt_out") {
    const stamp = now.toISOString();
    if (!(await insertReply(db, { ...base, kind: "opt_out", quote: c.quote, label: "no_thanks", labelled_by: "pulse", labelled_at: stamp }))) return null;
    if (priorKinds.includes("opt_out")) return "opt_out";
    // Any reply of theirs still waiting for a label is answered by this.
    await db.from("outreach_replies").update({ label: "no_thanks", labelled_by: "pulse", labelled_at: stamp }).eq("prospect_id", p.id).eq("kind", "reply").is("label", null);
    await cancelFollowUp(db, p.id, "They opted out");
    await closeAndSuppress(db, p, "no_thanks", sent, "pulse");
    await event(db, p.id, "opted_out", { test, quote: c.quote.slice(0, 300) }, sent.id);
    await notifyAdmins(null, "outreach", {
      title: `${tag}${name} opted out`,
      body: `"${c.quote.slice(0, 300)}"\n\n${test ? "A test send: nothing was added to do-not-contact." : "On do-not-contact for good, and the follow-up is cancelled. Nothing was sent back to them."}`,
      link: "/admin/outreach?tab=replies",
    });
    return "opt_out";
  }

  // After their first reply, the thread is Kyle's conversation.
  if (priorKinds.length) return "kyle's";

  if (!(await insertReply(db, { ...base, kind: "reply", quote: c.quote }))) return null;
  await cancelFollowUp(db, p.id, "They replied");
  await db.from("outreach_prospects").update({ status: "replied" }).eq("id", p.id).in("status", ["queued", "sent", "followed_up"]);
  await event(db, p.id, "replied", { test }, sent.id);
  await notifyAdmins(null, "outreach", {
    title: `${tag}Reply from ${name}`,
    body: `"${c.quote.slice(0, 400)}"\n\nAnswer it yourself from kyle@hartwelldigital.com, then label it on the Draper page.`,
    link: "/admin/outreach?tab=replies",
  });
  return "reply";
}

const NOTE: Record<Exclude<Handled, "kyle's">, string> = {
  bounce: "bounced",
  auto: "automatic",
  opt_out: "opted out",
  reply: "to label",
};

/**
 * Read new mail and act on it. Every ten minutes unless `force` (a follow-up
 * about to go, checking first). Returns a note when something happened, or
 * null; throws only if Gmail can't be reached.
 */
export async function checkReplies(db: SupabaseClient, now = new Date(), opts: { force?: boolean } = {}): Promise<string | null> {
  const st = await replyState(db);
  if (!opts.force && st.checkedAt && now.getTime() - new Date(st.checkedAt).getTime() < REPLY_CHECK_MINUTES * 60_000) return null;

  // Nothing sent yet: nothing to hear back from.
  const { data: firstSent } = await db.from("outreach_messages").select("sent_at").eq("status", "sent").order("sent_at").limit(1);
  const earliest = (firstSent as { sent_at: string }[] | null)?.[0]?.sent_at;
  if (!earliest) {
    await markChecked(db, now);
    return null;
  }
  const token = await gmailAccessToken(db);
  if ("error" in token) return null;

  const from = Math.max(new Date(earliest).getTime(), st.checkedAt ? new Date(st.checkedAt).getTime() : 0) - OVERLAP_MS;
  const ids = await listMessageIds(token.token, `-from:me after:${Math.floor(from / 1000)}`, 200);
  const { data: known } = ids.length
    ? await db.from("outreach_replies").select("gmail_message_id").in("gmail_message_id", ids.map((i) => i.id))
    : { data: [] };
  const seen = new Set(((known as { gmail_message_id: string }[] | null) ?? []).map((r) => r.gmail_message_id));
  const fresh = ids.filter((i) => !seen.has(i.id)).reverse();

  const counts: Partial<Record<Handled, number>> = {};
  if (fresh.length) {
    const lines = await ourLines(db);
    for (const i of fresh.slice(0, MAX_READ)) {
      const inc = parseMessage(await getMessage(token.token, i.id));
      if (inc.fromEmail === SENDER_EMAIL) continue;
      const sent = await matchSent(db, inc);
      if (!sent) continue;
      const r = await handleIncoming(db, inc, sent, lines, now);
      if (r) counts[r] = (counts[r] ?? 0) + 1;
    }
  }
  // More than one run's worth waiting: due again at the next tick.
  await markChecked(db, fresh.length > MAX_READ ? new Date(now.getTime() - REPLY_CHECK_MINUTES * 60_000) : now);

  const paused = await evaluateAutoPause(db);
  const noted = (Object.keys(NOTE) as (keyof typeof NOTE)[]).filter((k) => counts[k]).map((k) => `${counts[k]} ${NOTE[k]}`);
  if (!noted.length && !paused) return null;
  return `Replies: ${noted.join(", ") || "none new"}${paused ? `. Paused itself: ${paused}` : ""}`;
}

// ---------- auto-pause ----------

export async function autoPause(db: SupabaseClient, reason: string): Promise<boolean> {
  const { data } = await db
    .from("outreach_state")
    .update({ paused: true, paused_by: "auto", paused_reason: reason, paused_at: new Date().toISOString() })
    .eq("id", true)
    .eq("paused", false)
    .select("id");
  if (!data?.length) return false;
  await event(db, null, "auto_paused", { reason });
  await notifyAdmins(null, "outreach", {
    title: "Draper paused itself",
    body: `${reason}. Nothing sends until you resume it on the Draper page.`,
    link: "/admin/outreach",
  });
  return true;
}

/** The brief's auto-pause rules over real first emails since Kyle last resumed. */
export async function evaluateAutoPause(db: SupabaseClient): Promise<string | null> {
  const { data: s } = await db.from("outreach_state").select("paused").maybeSingle();
  if (!s || (s as { paused: boolean }).paused) return null;
  const { rulesSince } = await replyState(db);
  let q = db.from("outreach_messages").select("prospect_id, sent_at").eq("kind", "first").eq("status", "sent").eq("test_mode", false).order("sent_at", { ascending: false }).limit(100);
  if (rulesSince) q = q.gt("sent_at", rulesSince);
  const { data: firsts } = await q;
  const rows = (firsts as { prospect_id: string }[] | null) ?? [];
  if (!rows.length) return null;
  const { data: reps } = await db.from("outreach_replies").select("prospect_id, kind, label").in("prospect_id", rows.map((r) => r.prospect_id));
  const by = new Map<string, { kind: string; label: string | null }[]>();
  for (const r of (reps as { prospect_id: string; kind: string; label: string | null }[] | null) ?? []) {
    by.set(r.prospect_id, [...(by.get(r.prospect_id) ?? []), r]);
  }
  const list: SentFirst[] = rows.map((f) => {
    const rs = by.get(f.prospect_id) ?? [];
    return {
      bounced: rs.some((r) => r.kind === "bounce"),
      noThanks: rs.some((r) => r.kind === "opt_out" || r.label === "no_thanks"),
      interested: rs.some((r) => r.label === "interested" || r.label === "question"),
    };
  });
  const reason = autoPauseReason(list);
  if (reason && (await autoPause(db, reason))) return reason;
  return null;
}

/** Two "wrong fact" labels on real sends switch that fault off, counted from when it was last switched on. */
async function maybeFaultOff(db: SupabaseClient, fault: Fault) {
  const { data: lastOn } = await db.from("outreach_events").select("at").eq("kind", "fault_on").contains("detail", { fault }).order("at", { ascending: false }).limit(1);
  const since = (lastOn as { at: string }[] | null)?.[0]?.at ?? null;
  const { data: wf } = await db.from("outreach_replies").select("labelled_at, message_id").eq("label", "wrong_fact");
  const rows = (wf as { labelled_at: string; message_id: string | null }[] | null) ?? [];
  const ids = rows.map((r) => r.message_id).filter((x): x is string => !!x);
  if (!ids.length) return;
  const { data: ms } = await db.from("outreach_messages").select("id, fault, test_mode").in("id", ids);
  const real = new Map(((ms as { id: string; fault: Fault | null; test_mode: boolean | null }[] | null) ?? []).filter((m) => !m.test_mode).map((m) => [m.id, m.fault]));
  const count = rows.filter((r) => r.message_id && real.get(r.message_id) === fault && (!since || new Date(r.labelled_at) > new Date(since))).length;
  if (count < WRONG_FACTS_TO_SWITCH_OFF) return;
  const { data: st } = await db.from("outreach_state").select("faults_off").maybeSingle();
  const off = ((st as { faults_off: Fault[] } | null)?.faults_off ?? []) as Fault[];
  if (off.includes(fault)) return;
  await db.from("outreach_state").update({ faults_off: [...off, fault] }).eq("id", true);
  await event(db, null, "fault_off", { fault, wrong_facts: count });
  await notifyAdmins(null, "outreach", {
    title: `Draper stopped using "${FAULT_LABEL[fault]}"`,
    body: `${count} replies said it got that fact wrong. No new email will claim it until you switch it back on, on the Draper page.`,
    link: "/admin/outreach?tab=replies",
  });
}

// ---------- labels: Kyle's taps now, the morning run's in Stage 7 ----------

export type LabelResult = { ok: true; leadId: string | null } | { ok: false; message: string };

/**
 * Label a reply that's waiting. Interested or question makes a lead, due
 * today; later sets the day its card comes back; everything else closes the
 * prospect, and no thanks or a complaint on a real send also puts the
 * business on do-not-contact. A complaint pauses everything.
 * `actorId` goes in the lead's created_by.
 */
export async function applyLabel(
  db: SupabaseClient,
  replyId: string,
  label: string,
  laterOn: string | null,
  actor: "kyle" | "claude",
  actorId: string,
): Promise<LabelResult> {
  if (!isReplyLabel(label)) return { ok: false, message: "That isn't one of the labels." };
  const today = businessToday();
  if (label === "later" && !(laterOn && /^\d{4}-\d{2}-\d{2}$/.test(laterOn) && laterOn > today)) {
    return { ok: false, message: "Later needs a date after today." };
  }
  const { data: rRow } = await db.from("outreach_replies").select("id, prospect_id, message_id, kind, quote, label, received_at").eq("id", replyId).maybeSingle();
  const reply = rRow as { id: string; prospect_id: string; message_id: string | null; kind: string; quote: string | null; label: string | null; received_at: string } | null;
  if (!reply) return { ok: false, message: "That reply isn't there." };
  if (reply.kind !== "reply") return { ok: false, message: "Only a reply waiting for a label can be labelled." };
  if (reply.label) return { ok: false, message: `It's labelled ${LABEL_TEXT[reply.label as ReplyLabel] ?? reply.label} already.` };

  const patch = { label, later_on: label === "later" ? laterOn : null, labelled_by: actor, labelled_at: new Date().toISOString() };
  const { data: claimed, error } = await db.from("outreach_replies").update(patch).eq("id", replyId).is("label", null).select("id");
  if (error) return { ok: false, message: error.message };
  if (!claimed?.length) return { ok: false, message: "It was labelled a moment ago." };
  await db.from("outreach_replies").update(patch).eq("prospect_id", reply.prospect_id).eq("kind", "reply").is("label", null);

  const [{ data: pRow }, { data: sRow }] = await Promise.all([
    db.from("outreach_prospects").select(PROSPECT_COLS).eq("id", reply.prospect_id).single(),
    reply.message_id ? db.from("outreach_messages").select(SENT_COLS).eq("id", reply.message_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const p = pRow as ProspectRow;
  const sent = sRow as SentMsg | null;
  await event(db, p.id, "labelled", { label, ...(laterOn && label === "later" ? { later_on: laterOn } : {}) }, reply.message_id, actor);

  let leadId: string | null = null;
  if (MAKES_LEAD.has(label)) {
    leadId = await makeLead(db, p, sent, reply, label, actorId);
  } else if (label === "later") {
    await db.from("outreach_prospects").update({ status: "later", later_on: laterOn }).eq("id", p.id);
  } else {
    await closeAndSuppress(db, p, label, sent, actor);
  }

  if (label === "complaint" && !sent?.test_mode) await autoPause(db, `A reply from ${p.business_name ?? "a business"} was labelled complaint`);
  if (label === "no_thanks") await evaluateAutoPause(db);
  if (label === "wrong_fact" && sent?.fault && !sent.test_mode) await maybeFaultOff(db, sent.fault);
  return { ok: true, leadId };
}

async function makeLead(
  db: SupabaseClient,
  p: ProspectRow,
  sent: SentMsg | null,
  reply: { id: string; quote: string | null; received_at: string },
  label: ReplyLabel,
  actorId: string,
): Promise<string | null> {
  const { data: had } = await db.from("outreach_replies").select("lead_id").eq("prospect_id", p.id).not("lead_id", "is", null).limit(1);
  const existing = (had as { lead_id: string }[] | null)?.[0]?.lead_id;
  if (existing) {
    await db.from("outreach_replies").update({ lead_id: existing }).eq("id", reply.id);
    return existing;
  }
  const test = !!sent?.test_mode;
  const { data: c } = await db.from("outreach_contacts").select("email, first_name").eq("prospect_id", p.id).maybeSingle();
  const contact = c as { email: string | null; first_name: string | null } | null;
  const when = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" }).format(new Date(reply.received_at));
  const site = p.website_url ?? (p.domain ? `https://${p.domain}` : null);
  // No product names in here: the follow-up drafter reads these notes.
  const notes = [
    test ? "TEST MODE: this business never received an email. Delete this lead after the test." : null,
    `Replied to our email on ${when}: "${(reply.quote ?? "").slice(0, 1500)}"`,
    sent?.fault ? `Our email was about: ${FAULT_LABEL[sent.fault].toLowerCase()}.` : null,
    sent?.gmail_thread_id ? `The thread, in kyle@hartwelldigital.com: ${gmailThreadUrl(sent.gmail_thread_id)}` : null,
    site ? `Their site: ${site}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const input = {
    name: contact?.first_name ?? undefined,
    business: `${test ? "[Test] " : ""}${p.business_name ?? p.domain ?? "Outreach reply"}`,
    email: (test ? sent?.sent_to : contact?.email) ?? undefined,
    phone: test ? undefined : (p.phone ?? undefined),
    website: site ?? undefined,
    source: "outreach",
    follow_up_on: businessToday(),
    next_action: label === "question" ? "Answer their question" : "Reply and offer the written review",
    notes,
  };
  const createdNote = `From a reply to our outreach email (${LABEL_TEXT[label]})`;
  let r = await createLeadOp(db, actorId, input, createdNote);
  // Before 0066 the pipeline doesn't know the "outreach" source yet.
  if (!r.ok && /source|check constraint/i.test(r.message)) r = await createLeadOp(db, actorId, { ...input, source: "other" }, createdNote);
  if (!r.ok) {
    await notifyAdmins(null, "outreach", { title: `Couldn't add ${p.business_name ?? "a reply"} to the pipeline`, body: r.message, link: "/admin/outreach?tab=replies" });
    return null;
  }
  await db.from("outreach_replies").update({ lead_id: r.id }).eq("id", reply.id);
  await event(db, p.id, "lead_created", { lead_id: r.id, test }, sent?.id ?? null);
  return r.id;
}

/** A "later" card dealt with: closed. */
export async function closeLater(db: SupabaseClient, prospectId: string): Promise<boolean> {
  const { data } = await db.from("outreach_prospects").update({ status: "closed", later_on: null }).eq("id", prospectId).eq("status", "later").select("id");
  return !!data?.length;
}

/** Kyle switches a fault back on after the wrong-fact rule turned it off. */
export async function faultBackOn(db: SupabaseClient, fault: Fault): Promise<void> {
  const { data: st } = await db.from("outreach_state").select("faults_off").maybeSingle();
  const off = ((st as { faults_off: Fault[] } | null)?.faults_off ?? []) as Fault[];
  if (!off.includes(fault)) return;
  await db.from("outreach_state").update({ faults_off: off.filter((f) => f !== fault) }).eq("id", true);
  await event(db, null, "fault_on", { fault }, null, "kyle");
}
