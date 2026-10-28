import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { businessToday } from "@/lib/business-time";
import { sendEmail, escapeHtml } from "@/lib/email";
import { HARTWELL } from "@/lib/brand";
import { notifyAdmins } from "@/lib/notify";
import { brandedEmail, emailPara } from "@/lib/welcome-emails";
import { OPEN_DAYS, QUESTION, dueKind, group } from "@/lib/nps-shared";

/**
 * Client feedback (0058). The cron raises a round for each client that is
 * due and emails everyone on the account; Home shows the same question while
 * it is open; either answer lands here. A low score emails Kyle at once, and a
 * 9 or 10 is shown his Google review link.
 */

export interface Survey {
  id: string;
  client_id: string;
  user_id: string;
  email: string | null;
  kind: "first" | "quarterly";
  round: string;
  closes_at: string;
  sent_at: string | null;
  score: number | null;
  comment: string | null;
  answered_at: string | null;
  answered_via: "portal" | "email" | null;
  review_asked_at: string | null;
  created_at: string;
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const isMissing = (e: { code?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01");

export async function npsSettings(sb: SupabaseClient): Promise<{ enabled: boolean; reviewUrl: string | null }> {
  // select("*") so a database without 0058 reads as switched off, not as an error.
  const { data } = await sb.from("business_settings").select("*").eq("id", 1).maybeSingle();
  const s = (data ?? {}) as { nps_enabled?: boolean; google_review_url?: string | null };
  return { enabled: s.nps_enabled === true, reviewUrl: s.google_review_url?.trim() || null };
}

export interface PlannedRound {
  clientId: string;
  businessName: string;
  kind: "first" | "quarterly";
  people: { userId: string; email: string; name: string | null }[];
}

/** Who would be asked today. Read-only, so Settings can show it before anything is switched on. */
export async function planRound(sb: SupabaseClient, now: Date = new Date()): Promise<PlannedRound[] | null> {
  const today = businessToday(now);
  const [{ data: clients }, { data: ob }, { data: rounds, error: rErr }, { data: people }] = await Promise.all([
    sb.from("clients").select("id, business_name, status, created_at, deleted_at"),
    sb.from("onboarding").select("client_id, submitted_at"),
    sb.from("nps_surveys").select("client_id, round"),
    sb.from("client_users").select("clerk_user_id, client_id, full_name, email, role").eq("role", "client"),
  ]);
  if (isMissing(rErr)) return null;
  const started = new Map(((ob as { client_id: string; submitted_at: string | null }[] | null) ?? []).map((o) => [o.client_id, o.submitted_at]));
  const last = new Map<string, string>();
  for (const r of (rounds as { client_id: string; round: string }[] | null) ?? []) {
    if (!last.has(r.client_id) || r.round > last.get(r.client_id)!) last.set(r.client_id, r.round);
  }
  const out: PlannedRound[] = [];
  for (const c of (clients as { id: string; business_name: string; status: string; created_at: string; deleted_at: string | null }[] | null) ?? []) {
    if (c.deleted_at || c.status === "paused") continue;
    const start = businessToday(new Date(started.get(c.id) ?? c.created_at));
    const kind = dueKind(start, last.get(c.id) ?? null, today);
    if (!kind) continue;
    const who = ((people as { clerk_user_id: string; client_id: string; full_name: string | null; email: string | null }[] | null) ?? [])
      .filter((u) => u.client_id === c.id && u.email)
      .map((u) => ({ userId: u.clerk_user_id, email: u.email as string, name: u.full_name }));
    if (who.length) out.push({ clientId: c.id, businessName: c.business_name, kind, people: who });
  }
  return out;
}

export function npsEmail(opts: { origin: string; first: string; token: string }): { subject: string; html: string } {
  const cell = (n: number) =>
    `<td style="padding:0 3px 0 0"><a href="${opts.origin}/nps/${opts.token}?s=${n}" style="display:block;width:36px;height:36px;line-height:36px;text-align:center;border:1px solid #d8d0bc;border-radius:2px;color:#0e0d0b;font-weight:700;font-size:14px;text-decoration:none">${n}</a></td>`;
  const scale = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 6px"><tr>${Array.from({ length: 11 }, (_, i) => cell(i)).join("")}</tr></table>
  <table role="presentation" width="100%" style="max-width:429px;font-size:12px;color:#888"><tr><td>Not likely</td><td style="text-align:right">Very likely</td></tr></table>`;
  return {
    subject: `A quick question, ${opts.first}`,
    html: brandedEmail(
      opts.origin,
      `${emailPara(`Hi ${escapeHtml(opts.first)},`)}${emailPara(`One question, and it takes ten seconds. ${escapeHtml(QUESTION)} Tap a number:`)}${scale}${emailPara(
        "You can add a sentence on the next screen if you like. Whatever the number, I read every one, and I'd rather hear it than not.",
      )}`,
    ),
  };
}

/**
 * Raise today's round and email it. A person can only be asked once per round
 * (unique on client, person, round), so a second run on the same day does
 * nothing. Off unless Kyle has switched surveys on.
 */
export async function runSurveys(sb: SupabaseClient, origin: string, now: Date = new Date(), max = 25): Promise<{ asked: number; skipped?: string }> {
  const settings = await npsSettings(sb);
  if (!settings.enabled) return { asked: 0, skipped: "off" };
  const plan = await planRound(sb, now);
  if (!plan) return { asked: 0, skipped: "run migration 0058" };
  const today = businessToday(now);
  let asked = 0;
  for (const round of plan) {
    for (const person of round.people) {
      if (asked >= max) return { asked };
      const token = randomBytes(24).toString("base64url");
      const { data, error } = await sb
        .from("nps_surveys")
        .insert({
          client_id: round.clientId,
          user_id: person.userId,
          email: person.email,
          token_hash: hash(token),
          kind: round.kind,
          round: today,
          closes_at: new Date(now.getTime() + OPEN_DAYS * 86_400_000).toISOString(),
        })
        .select("id")
        .single();
      if (error || !data) continue; // already asked this round, or a write that failed: never email without a row
      const first = person.name?.trim().split(/\s+/)[0] || "there";
      const mail = npsEmail({ origin, first, token });
      const res = await sendEmail({ to: person.email, subject: mail.subject, html: mail.html, ref: { kind: "other", id: (data as { id: string }).id } });
      if (!res.error && !res.skipped) {
        await sb.from("nps_surveys").update({ sent_at: new Date().toISOString() }).eq("id", (data as { id: string }).id);
        asked++;
      }
    }
  }
  return { asked };
}

export async function surveyByToken(sb: SupabaseClient, token: string): Promise<Survey | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data } = await sb.from("nps_surveys").select("*").eq("token_hash", hash(token)).maybeSingle();
  return (data as Survey | null) ?? null;
}

/** The survey Home should show this person, if one is open. */
export async function openSurveyFor(sb: SupabaseClient, userId: string): Promise<Survey | null> {
  const { data, error } = await sb
    .from("nps_surveys")
    .select("*")
    .eq("user_id", userId)
    .is("answered_at", null)
    .gt("closes_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return ((data as Survey[] | null) ?? [])[0] ?? null;
}

export type AnswerResult = { ok: true; group: "promoter" | "passive" | "detractor"; reviewUrl: string | null } | { ok: false; message: string };

/**
 * Record an answer, once. The update is conditional on no answer yet, so a
 * double tap, or the portal and the email both used, records the first.
 */
export async function recordAnswer(
  sb: SupabaseClient,
  survey: Survey,
  score: number,
  comment: string,
  via: "portal" | "email",
): Promise<AnswerResult> {
  if (!Number.isInteger(score) || score < 0 || score > 10) return { ok: false, message: "Pick a number from 0 to 10." };
  const text = comment.trim().slice(0, 2000) || null;
  const { data: claimed } = await sb
    .from("nps_surveys")
    .update({ score, comment: text, answered_at: new Date().toISOString(), answered_via: via })
    .eq("id", survey.id)
    .is("answered_at", null)
    .select("id");
  if (!claimed?.length) return { ok: false, message: "We already have your answer. Thank you." };

  const [{ data: client }, { data: person }, settings] = await Promise.all([
    sb.from("clients").select("business_name").eq("id", survey.client_id).maybeSingle(),
    sb.from("client_users").select("full_name").eq("clerk_user_id", survey.user_id).maybeSingle(),
    npsSettings(sb),
  ]);
  const business = (client as { business_name: string } | null)?.business_name ?? "A client";
  const who = (person as { full_name: string | null } | null)?.full_name ?? survey.email ?? "Someone";
  const g = group(score);
  const title = `${business} scored you ${score}/10`;
  const body = text ? `${who}: "${text}"` : `${who}, no comment.`;

  if (g === "detractor") {
    // Straight away, not on the next email run: this one needs a call.
    await sendEmail({
      to: HARTWELL.email,
      subject: `Low score: ${business} gave ${score}/10`,
      html: brandedEmail(
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || `https://${HARTWELL.site}`,
        `${emailPara(`<strong>${escapeHtml(who)}</strong> at ${escapeHtml(business)} answered ${score} out of 10.`)}${emailPara(
          text ? `Their reason: "${escapeHtml(text)}"` : "They didn't leave a reason.",
        )}${emailPara("Worth a call today, while it's fresh.")}`,
        { label: "See feedback", href: `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || `https://${HARTWELL.site}`}/admin/feedback` },
      ),
      ref: { kind: "other", id: survey.id },
    });
    await notifyAdmins(survey.client_id, "nps", { title, body, link: "/admin/feedback" }, "in_portal");
  } else {
    await notifyAdmins(survey.client_id, "nps", { title, body, link: "/admin/feedback" });
  }

  let reviewUrl: string | null = null;
  if (g === "promoter" && settings.reviewUrl) {
    reviewUrl = settings.reviewUrl;
    await sb.from("nps_surveys").update({ review_asked_at: new Date().toISOString() }).eq("id", survey.id);
  }
  return { ok: true, group: g, reviewUrl };
}
