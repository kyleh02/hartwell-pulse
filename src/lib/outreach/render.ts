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
): { first: RenderedEmail; followUp: RenderedEmail; problems: string[] } {
  const problems: string[] = [];
  if (r.otherFaults < 1) problems.push("Only one fault is on record; a prospect needs two, one for each email.");
  const optOutLine = r.optOut === "B" ? t.opt_out_b : t.opt_out_a;
  const values: Record<string, string> = {
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
  const followUp = { subject: fill(t.followup_subject, { ...values, subject: firstSubject }), body: fill(t.followup_body, values) };

  for (const [name, email, source] of [
    ["first email", first, t.first_body],
    ["follow-up", followUp, t.followup_body],
  ] as const) {
    if (/\{[a-z_]+\}/.test(`${email.subject}\n${email.body}`)) problems.push(`The ${name} still has a placeholder in it.`);
    for (const line of fixedLines(source)) {
      if (!email.body.includes(line)) problems.push(`The ${name} is missing Kyle's fixed text: "${line}"`);
    }
  }
  if (!followUp.body.includes(optOutLine)) problems.push("The follow-up is missing its opt-out line.");
  if (!first.body.includes(t.opt_out_a)) problems.push("The first email is missing its opt-out line.");
  return { first, followUp, problems };
}
