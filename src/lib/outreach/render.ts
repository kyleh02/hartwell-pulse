/**
 * Kyle's template, filled. The wording is his; Pulse fills every {placeholder}
 * and Claude's three slots arrive already checked. renderMessages() then proves
 * the fixed text came through unchanged: every template line with no
 * placeholder in it must appear, word for word, in the email. Pure.
 */
import type { Template } from "./types.ts";

export type TemplateText = Pick<
  Template,
  "first_subject" | "first_body" | "followup_subject" | "followup_body" | "opt_out_a" | "opt_out_b"
>;

export interface RenderInput {
  /** Already checked against the measured page. */
  pageName: string;
  /** Published with the address, or null for "there". */
  firstName: string | null;
  /** Faults on record besides the first email's: 1 is "another thing", 2+ "a couple of other things". */
  otherFaults: number;
  optOut: "A" | "B";
  /** Claude's slots with their tokens already filled. */
  slots: { finding: string; why_and_fix: string; second_finding: string };
  /** platformWords() of the business's fresh, live ad checks: the ads template's {ad_platform}. */
  adPlatform?: string | null;
}

/** A template written around the business's live ads (Draper v2). */
export function isAdsTemplate(t: Pick<TemplateText, "first_subject" | "first_body">): boolean {
  return /\{ad_platform\}/.test(`${t.first_subject}\n${t.first_body}`);
}

/** The give-first template (27 November 2026): Pulse writes the finding, the fix and the steps itself. */
export function isGiveFirstTemplate(t: Pick<TemplateText, "first_subject" | "first_body">): boolean {
  return /\{fix\}/.test(t.first_body);
}

/** Either template that needs live ads from a fresh ad-library check. */
export function needsLiveAds(t: Pick<TemplateText, "first_subject" | "first_body">): boolean {
  return isAdsTemplate(t) || isGiveFirstTemplate(t);
}

/**
 * The give-first pair, filled from Pulse's own copy (give-first.ts). The same
 * proof as renderMessages: no placeholder left, and every line Kyle wrote
 * arrives word for word.
 */
export function renderGiveFirst(
  t: TemplateText,
  r: { firstName: string | null; optOut: "A" | "B"; gapPlatform: string; subjectTail: string; finding: string; fix: string; steps: string },
): { first: RenderedEmail; followUp: RenderedEmail; problems: string[] } {
  const problems: string[] = [];
  const optOutLine = r.optOut === "B" ? t.opt_out_b : t.opt_out_a;
  const values: Record<string, string> = {
    first_name_or_there: greeting(r.firstName),
    gap_platform: r.gapPlatform,
    subject_tail: r.subjectTail,
    finding: r.finding.trim(),
    fix: r.fix.trim(),
    steps: r.steps.trim(),
    opt_out_line: optOutLine,
  };
  const subject = fill(t.first_subject, values);
  const first = { subject, body: fill(t.first_body, values) };
  const followUp = { subject: fill(t.followup_subject, { ...values, subject }), body: fill(t.followup_body, values) };
  for (const [name, email, source] of [
    ["first email", first, t.first_body],
    ["follow-up", followUp, t.followup_body],
  ] as const) {
    if (/\{[a-z_]+\}/.test(`${email.subject}\n${email.body}`)) problems.push(`The ${name} still has a placeholder in it.`);
    for (const line of fixedLines(source)) if (!email.body.includes(line)) problems.push(`The ${name} is missing Kyle's fixed text: "${line}"`);
    if (/[—–]|\s-\s|--|!/.test(`${email.subject}\n${email.body}`)) problems.push(`The ${name} has a dash or an exclamation mark in it.`);
  }
  if (!first.body.includes(t.opt_out_a)) problems.push("The first email is missing its opt-out line.");
  if (!followUp.body.includes(optOutLine)) problems.push("The follow-up is missing its opt-out line.");
  return { first, followUp, problems };
}

/**
 * The ads template's offer line, by how many other faults are on record.
 * Kyle's offer from the brand direction: a free ads review, emailed within two
 * working days, nothing to book.
 */
export function reviewLine(otherFaults: number): string {
  if (otherFaults >= 2) return "We noticed a couple of other things too. Reply yes for a free ads review covering the lot, emailed within two working days, no call needed.";
  if (otherFaults === 1) return "We noticed another thing too. Reply yes for a free ads review covering both, emailed within two working days, no call needed.";
  return "Reply yes for a free ads review, emailed within two working days, no call needed.";
}

export interface RenderedEmail {
  subject: string;
  body: string;
}

/** A first name fit to greet with, or "there". */
export function greeting(firstName: string | null): string {
  const n = (firstName ?? "").trim();
  return /^[A-Za-z][A-Za-z'’-]{0,29}$/.test(n) ? n : "there";
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in values ? values[key] : whole));
}

/** Template lines with no placeholder: the text Kyle wrote that must arrive unchanged. */
function fixedLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/\{[a-z_]+\}/.test(l));
}

export function renderMessages(
  t: TemplateText,
  r: RenderInput,
): { first: RenderedEmail; followUp: RenderedEmail | null; problems: string[] } {
  const problems: string[] = [];
  const ads = isAdsTemplate(t);
  // Kyle's first template promises "other things" and always has a follow-up.
  // The ads template needs one fault; the follow-up only comes with a second.
  if (!ads && r.otherFaults < 1) problems.push("Only one fault is on record; a prospect needs two, one for each email.");
  if (ads && !r.adPlatform) problems.push("No live ads are on record from a fresh check, so the ads template can't be filled.");
  const hasFollowUp = !ads || r.slots.second_finding.trim() !== "";
  const optOutLine = r.optOut === "B" ? t.opt_out_b : t.opt_out_a;
  const values: Record<string, string> = {
    ad_platform: r.adPlatform ?? "",
    review_line: reviewLine(r.otherFaults),
    page_name: r.pageName.trim(),
    first_name_or_there: greeting(r.firstName),
    finding: r.slots.finding.trim(),
    why_and_fix: r.slots.why_and_fix.trim(),
    other_things: r.otherFaults >= 2 ? "a couple of other things" : "another thing",
    it_or_them: r.otherFaults >= 2 ? "them" : "it",
    second_finding: r.slots.second_finding.trim(),
    opt_out_line: optOutLine,
  };
  const firstSubject = fill(t.first_subject, values);
  const first = { subject: firstSubject, body: fill(t.first_body, values) };
  const followUp = hasFollowUp
    ? { subject: fill(t.followup_subject, { ...values, subject: firstSubject }), body: fill(t.followup_body, values) }
    : null;

  for (const [name, email, source] of [
    ["first email", first, t.first_body],
    ...(followUp ? ([["follow-up", followUp, t.followup_body]] as const) : []),
  ] as const) {
    if (/\{[a-z_]+\}/.test(`${email.subject}\n${email.body}`)) problems.push(`The ${name} still has a placeholder in it.`);
    for (const line of fixedLines(source)) {
      if (!email.body.includes(line)) problems.push(`The ${name} is missing Kyle's fixed text: "${line}"`);
    }
  }
  if (followUp && !followUp.body.includes(optOutLine)) problems.push("The follow-up is missing its opt-out line.");
  if (!first.body.includes(t.opt_out_a)) problems.push("The first email is missing its opt-out line.");
  return { first, followUp, problems };
}

/**
 * The follow-up alone, rendered again on its morning with that day's figures
 * (the brief: "the second fault, re-measured that morning").
 */
export function renderFollowUp(
  t: TemplateText,
  r: { firstName: string | null; optOut: "A" | "B"; secondFinding: string },
): { body: string; problems: string[] } {
  const optOutLine = r.optOut === "B" ? t.opt_out_b : t.opt_out_a;
  const body = fill(t.followup_body, {
    first_name_or_there: greeting(r.firstName),
    second_finding: r.secondFinding.trim(),
    opt_out_line: optOutLine,
  });
  const problems: string[] = [];
  if (/\{[a-z_]+\}/.test(body)) problems.push("The follow-up still has a placeholder in it.");
  for (const line of fixedLines(t.followup_body)) if (!body.includes(line)) problems.push(`The follow-up is missing Kyle's fixed text: "${line}"`);
  if (!body.includes(optOutLine)) problems.push("The follow-up is missing its opt-out line.");
  return { body, problems };
}
