/**
 * The message lint (Kyle's brief, "Lint, in code"). Claude writes at most
 * three short slots inside Kyle's fixed template; these rules refuse a slot
 * that breaks his house rules. They are word and pattern lists (decision 6):
 * they catch the obvious cases and will miss a clever rewording, which is why
 * the fixed template, not this file, is the real limit.
 *
 * Wording rules run on the slot as Claude wrote it, with tokens blanked, so a
 * page name Pulse fills in (a "quote" page, say) can't trip a rule. Length and
 * punctuation run on the slot as it will be sent. Pure; lint.test.ts.
 */
import { isToken, tokensIn } from "./tokens.ts";

export const SLOTS = ["finding", "why_and_fix", "second_finding"] as const;
export type SlotName = (typeof SLOTS)[number];

export const MAX_SLOT_WORDS = 60;
export const MAX_SENTENCES: Record<SlotName, number> = { finding: 2, why_and_fix: 2, second_finding: 2 };

export interface LintIssue {
  slot: SlotName;
  rule: string;
  detail: string;
}

/** [pattern, rule, what to tell Claude]. Case-insensitive unless noted. */
const WORDING: [RegExp, string, string][] = [
  [/\b(honestly|genuinely|straightforward|plain english)\b/i, "banned word", "uses a word Kyle doesn't use"],
  [/\bdraper\b/i, "system name", "names the system; it never appears in an email"],
  [/(^|[^A-Za-z])I(['’](m|ve|d|ll))?(?![A-Za-z])/, "first person", 'says "I"; Hartwell speaks as "we"'],
  [/\b(me|my|mine|myself)\b/i, "first person", 'says "me" or "my"; Hartwell speaks as "we"'],
  [/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|au|io|co|biz|info|me)\b|@[a-z0-9-]+\./i, "link", "contains a link or a web or email address"],
  [/[$%]|\b(per ?cent|percent|percentage|fees?|prices?|pricing|costs?|cheap|discount|free of charge|no charge)\b/i, "price", "mentions prices, fees or percentages"],
  [/\b(give us a call|call us|call me|ring us|(quick|short|brief) (call|chat)|a chat|have a chat|meet(ing|ings|up)?|catch up|book (a|in)|schedule|calendar|zoom|coffee|(jump|hop) on a)\b/i, "meeting ask", "asks for a call or a meeting"],
  [/\b(agenc(y|ies)|whoever|your (developer|web ?designer|designer|web developer|marketer|seo|it (person|guy))|your marketing (person|team|company)|(built|designed|made|set up|runs?|ran|manages?|managing) your (site|website|ads|google ads|meta ads|campaigns?))\b/i, "who runs it", "mentions an agency or whoever runs their ads or site"],
  [/\b(our team|our experts?|our specialists?|team of|we['’]?re (a|an|the) |we are (a|an|the) |years of experience|we['’]?ve (helped|worked)|we have (helped|worked)|certified|accredited|google partner|meta partner|award[- ]winning|boutique)\b/i, "team description", "describes our team"],
  [/\b(guarantee[ds]?|will (increase|boost|double|triple|grow|improve|lift|bring|get you|deliver|generate)|more (leads|sales|customers|clients|enquiries|bookings|revenue|calls)|skyrocket|10x|results)\b/i, "promise", "promises results"],
  [/\b(heal(s|ing)?|cure[sd]?|treat(s|ment|ments|ing)?|therap(y|ies|eutic)|pain|relie(f|ve|ves)|detox|immun(e|ity)|anxiety|depression|injur(y|ies)|rehab(ilitation)?|medical|clinical(ly)?|symptoms?|diagnos[a-z]*)\b/i, "health claim", "makes a health or treatment claim"],
  [/\b(spend(s|ing)?|spent|budgets?|wast(e|es|ed|ing)|money)\b/i, "ad spend", "talks about their spend; the ad signal is only ever a likelihood"],
];

/** Figures must come through tokens, so none may be written out. */
const FIGURES: [RegExp, string][] = [
  [/[0-9]/, "writes a digit; figures come from Pulse through tokens like [[first_paint]]"],
  [/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday|tomorrow|tonight)\b/i, "names a day; use [[day]]"],
  [/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/, "names a month; the email gives only the weekday"],
  [/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a few|several|half a|a couple of)\s+(seconds?|minutes?|secs?)\b/i, "writes a time out; use [[first_paint]] or [[largest_paint]]"],
  [/\b(twice|two times|three times|four times)\b/i, "writes a count out; use [[pageviews]]"],
];

// American spellings, and the -ize family less the words that are spelt that way here too.
const US_WORDS =
  /\b(colors?|colored|colorful|favor(s|ed|ite|ites)?|behavior(s|al)?|center(s|ed)?|analyze[ds]?|analyzing|catalog(s)?|defense|offense|gray|traveled|traveling|traveler|canceled|canceling|tires?|aluminum|labor|neighbor(s|hood)?|honor(s|ed)?|humor|flavor(s)?|rumor(s)?|harbor(s)?|endeavor(s)?|liter(s)?|kilometer(s)?|jewelry|fulfill|enroll|skeptical|mold|plow|pediatric)\b/i;
const IZE = /\b([a-z]+)(ize|izes|ized|izing|ization|izations|izer|izers)\b/gi;
const IZE_OK = new Set(["s", "pr", "se", "caps", "ma", "ba", "res", "outs", "overs", "downs", "ups", "supers"]);

function americanSpelling(text: string): string | null {
  const w = US_WORDS.exec(text)?.[0];
  if (w) return w;
  for (const m of text.matchAll(IZE)) if (!IZE_OK.has(m[1].toLowerCase())) return m[0];
  return null;
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentences(text: string): number {
  return text.trim() ? text.trim().split(/(?<=[.?])\s+/).filter(Boolean).length : 0;
}

/**
 * Lint one slot. `raw` is what Claude wrote (with tokens), `rendered` the same
 * with tokens filled in, as it will be sent.
 */
export function lintSlot(slot: SlotName, raw: string, rendered: string): LintIssue[] {
  const out: LintIssue[] = [];
  const add = (rule: string, detail: string) => out.push({ slot, rule, detail });
  if (!raw.trim()) {
    add("empty", "is empty");
    return out;
  }
  for (const t of tokensIn(raw)) if (!isToken(t)) add("unknown token", `uses [[${t}]], which isn't a token Pulse fills`);
  const blanked = raw.replace(/\[\[\s*[a-z_]+\s*\]\]/g, "X");
  // Trade words with a number in them aren't figures: 4WD, 4x4, 12-volt, 12V.
  const tradeless = blanked.replace(/\b\d+(?:wd\b|x\d+\b|v\b|-volts?\b|-wheel(?:-drive)?\b)/gi, "Z");
  for (const [re, detail] of FIGURES) if (re.test(tradeless)) add("figure", detail);
  for (const [re, rule, detail] of WORDING) if (re.test(blanked)) add(rule, detail);
  const us = americanSpelling(blanked);
  if (us) add("spelling", `spells "${us}" the American way; use Australian spelling`);
  // Punctuation and length on what will actually be sent.
  if (/[—–]|\s-\s|--/.test(rendered)) add("dash", "uses a dash; Kyle's emails have none");
  if (rendered.includes("!")) add("exclamation", "uses an exclamation mark");
  if (/\[\[|\]\]|\{|\}/.test(rendered)) add("unfilled", "still has a token or brace in it");
  const n = words(rendered);
  if (n > MAX_SLOT_WORDS) add("too long", `is ${n} words; ${MAX_SLOT_WORDS} at most`);
  const s = sentences(rendered);
  if (s > MAX_SENTENCES[slot]) add("too many sentences", `is ${s} sentences; ${MAX_SENTENCES[slot]} at most`);
  return out;
}

/** Lint every slot. */
export function lintSlots(raw: Record<SlotName, string>, rendered: Record<SlotName, string>): LintIssue[] {
  return SLOTS.flatMap((s) => lintSlot(s, raw[s] ?? "", rendered[s] ?? ""));
}

/** One line per issue, for a refusal Claude can act on. */
export function describe(issues: LintIssue[]): string[] {
  const label: Record<SlotName, string> = { finding: "{finding}", why_and_fix: "{why_and_fix}", second_finding: "{second_finding}" };
  return issues.map((i) => `${label[i.slot]} ${i.detail}.`);
}
