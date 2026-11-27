/**
 * The free ads review, drafted by Pulse for Kyle to finish (Kyle, 27 November
 * 2026: "Yes let's do that"). Every Draper email offers one, written within
 * two working days of a yes. It never sends: Kyle copies it, edits it in
 * kyle@'s Gmail and sends it himself.
 *
 * Its shape, from Kyle's four answers the same day:
 *   1. The three things we'd change first, the ads themselves leading. Pulse
 *      reads their live Facebook ads' words: an offer whose date has passed,
 *      ads that say little more than the business name, or one ad running
 *      for six months or more. The tracking gap comes next, pointing to the
 *      steps in our last email rather than repeating them.
 *   2. Who else nearby is advertising, NAMED (Kyle: "I think we should name
 *      them"), from the PC run's competitor search the morning after a yes
 *      (competitors-rules.ts).
 *   3. For the record: the ad and tracking readings, at the bottom.
 *   Never site speed (Kyle: "too generic"). Numbers to twenty as words.
 *
 * What only Kyle can judge is left as bracketed lines for him to write or
 * delete. Brand rules: we, no fee or figure about what we charge (a fixed
 * monthly fee, set by the job, not a percentage of ad spend, in writing),
 * Australian English, no dashes in sentences. Pure; review-draft.test.ts.
 */
import type { Fault } from "./rules.ts";
import type { TrackingFacts } from "./measure-rules.ts";
import { greeting } from "./render.ts";
import { giveFirstCopy, LEAD, type LeadWord } from "./give-first.ts";
import { nameKey, numberWord, timesWords } from "./tokens.ts";
import { adCards, openingLine, type AdCard } from "./ad-cards.ts";
import type { CompetitorCheck } from "./competitors-rules.ts";

export interface ReviewInput {
  /** The name the emails used, or the business name on file. */
  business: string;
  firstName: string | null;
  domain: string | null;
  leadWord: LeadWord;
  /** The newest Meta check: live ads on their domain, the earliest start, and the page text Pulse read. */
  meta: { live: boolean; ads: number; started: string | null; pageText: string } | null;
  /** The newest Google check. */
  google: { live: boolean; ads: number; lastShown: string | null } | null;
  /** The newest measurement Pulse could read. */
  measurement: {
    url: string;
    faults: Fault[];
    pageviews: number;
    brokenPages: string[];
    tracking: TrackingFacts | null;
  } | null;
  /** Our follow-up, with the steps, has gone to them. */
  followUpSent: boolean;
  /** The newest competitor search, or null when none has run. */
  competitors: CompetitorCheck | null;
  /** Melbourne date, YYYY-MM-DD. */
  today: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "24 September 2025". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] ?? ""} ${y}`;
}

/** Their live ads pointing at their site, each with its opening words, newest library order kept. */
function ownAds(pageText: string, domain: string): { card: AdCard; line: string }[] {
  const out: { card: AdCard; line: string }[] = [];
  for (const c of adCards(pageText)) {
    if (!c.active || !c.raw.toLowerCase().includes(domain.toLowerCase())) continue;
    const line = openingLine(c);
    if (line) out.push({ card: c, line });
  }
  return out;
}

/**
 * The opening words of each live ad pointing at their site, with when it
 * started. At most `max`, each cut to about a line, no repeats.
 */
export function liveAdLines(pageText: string, domain: string, max = 3): { text: string; started: string | null }[] {
  const out: { text: string; started: string | null }[] = [];
  for (const { card, line } of ownAds(pageText, domain)) {
    const text = line.length > 110 ? `${line.slice(0, 107).replace(/\s+\S*$/, "")}...` : line;
    if (out.some((o) => o.text === text)) continue;
    out.push({ text, started: card.started });
    if (out.length >= max) break;
  }
  return out;
}

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "about eight months", "over a year", "over two years". */
export function runWords(started: string, today: string): string {
  const months = Math.floor(days(started, today) / 30.44);
  if (months < 12) return `about ${numberWord(months)} months`;
  const years = Math.floor(months / 12);
  return years === 1 ? "over a year" : `over ${numberWord(years)} years`;
}

const MONTH_RE = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";
const monthIndex = (m: string) => MONTHS.findIndex((x) => x.toLowerCase().startsWith(m.toLowerCase().slice(0, 3)));

/**
 * An offer in the ad's words that ended before today: "ends 30 June",
 * "until November 15th". The date is taken in the year the ad started, or
 * the year after when it falls before the start. Returns the date's words.
 */
export function pastOffer(words: string, started: string | null, today: string): string | null {
  const t = words.toLowerCase();
  const end = String.raw`\b(?:ends?|ending|until|till|expires?|closes?|before)\s+(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?`;
  const a = new RegExp(`${end}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`).exec(t);
  const b = a ? null : new RegExp(`${end}${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  const day = a ? Number(a[1]) : b ? Number(b[2]) : NaN;
  const mon = a ? monthIndex(a[2]) : b ? monthIndex(b[1]) : -1;
  if (!(day >= 1 && day <= 31) || mon < 0) return null;
  const from = started ?? today;
  let year = Number(from.slice(0, 4));
  const iso = (y: number) => `${y}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (iso(year) < from) year++;
  return iso(year) < today ? `${day} ${MONTHS[mon]}` : null;
}

/** An ad's words for quoting mid-sentence: no full stop or exclamation mark at the end. */
const q = (line: string) => line.replace(/[\s.!]+$/, "");

/** Does an ad's opening say little more than the business's own name? */
function nameOnly(line: string, names: string[]): boolean {
  const filler = new Set(["co", "pty", "ltd", "the", "and"]);
  const w = nameKey(line).split(" ").filter((x) => x && !filler.has(x));
  if (w.length <= 2) return true;
  const known = new Set(names.flatMap((n) => nameKey(n).split(" ")));
  return w.every((x) => known.has(x));
}

/** What Pulse can say about the ads' own words, best first. Each ends with Kyle's line to write. */
function adFindings(r: ReviewInput): string[] {
  if (!r.meta?.live || !r.domain) return [];
  const ads = ownAds(r.meta.pageText, r.domain);
  if (!ads.length) return [];
  const out: string[] = [];

  const ended = ads.map((a) => ({ a, when: pastOffer(a.card.body.join(" "), a.card.started, r.today) })).find((x) => x.when);
  if (ended) {
    out.push(`Take down the offer that's finished. Your Facebook ad "${q(ended.a.line)}" is still running, but its date, ${ended.when}, has passed. [Kyle: what you'd run in its place.]`);
  }

  const n = ads.length;
  const plain = ads.filter((a) => nameOnly(a.line, [r.business, a.card.name ?? ""]));
  if (plain.length) {
    const who = n === 1 ? "your Facebook ad" : plain.length === n ? `all ${numberWord(n)} of your Facebook ads` : `${numberWord(plain.length)} of your ${numberWord(n)} Facebook ads`;
    const lines = [...new Set(plain.map((a) => q(a.line)))];
    const what = lines.length === 1 ? `are just "${lines[0]}"` : "are little more than your business name";
    out.push(`Give your ads something to say. In Meta's Ad Library, the words in ${who} ${what}. [Kyle: the line you'd lead with instead, and why.]`);
  }

  const oldest = ads
    .filter((a) => !plain.includes(a) && a !== ended?.a && a.card.started && days(a.card.started, r.today) >= 183)
    .sort((a, b) => a.card.started!.localeCompare(b.card.started!))[0];
  if (oldest) {
    out.push(
      `Freshen up your longest running ad. "${q(oldest.line)}" has been running since ${longDate(oldest.card.started!)}, ${runWords(oldest.card.started!, r.today)}, and people who keep seeing the same ad tend to stop noticing it. [Kyle: what the fresh one would say.]`,
    );
  }
  return out;
}

/** "asks for a quote", "books", "gets in touch". */
const WHO: Record<LeadWord, string> = { quotes: "asks for a quote", bookings: "books", enquiries: "gets in touch" };

/** The tracking gap as one change, and its steps (or a pointer to our last email). */
function trackingChange(r: ReviewInput): string | null {
  const m = r.measurement;
  const t = m?.tracking ?? null;
  if (!m || !t) return "[Kyle: Pulse has no tracking reading for this site; measure its home page again on the Draper page.]";
  const has = (f: Fault) => m.faults.includes(f);
  const L = LEAD[r.leadWord];
  const metaGap = !!r.meta?.live && has("no_meta_pixel");
  const googleGap = !!r.google?.live && has("no_google_tag");
  const doubled = !!r.meta?.live && has("pixel_double") && m.pageviews >= 2;
  let what: string;
  if (metaGap && googleGap) {
    what = `Let Google and Facebook see who ${WHO[r.leadWord]}. The site has no Meta Pixel and no Google tag, so neither can tell which clicks turned into ${L.plural}, or aim your ads at people likely to ${L.verb}.`;
  } else if (metaGap) {
    what = `Let Facebook see who ${WHO[r.leadWord]}. The site has no Meta Pixel, so Facebook can only aim your ads at people likely to click, not people likely to ${L.verb}.`;
  } else if (googleGap) {
    what = `Let Google see who ${WHO[r.leadWord]}. The site has no Google tag, so Google can't tell which clicks turned into ${L.plural}, and can only aim your ads at people likely to click.`;
  } else if (doubled) {
    what = `Fix the Meta Pixel's count. The Pixel on your home page counts each visit ${timesWords(m.pageviews)}, so the numbers you judge your Facebook ads by start out wrong.`;
  } else {
    return null;
  }
  if (r.followUpSent) return `${what} The steps are in our last email.`;
  const live = [...(r.meta?.live ? (["meta"] as const) : []), ...(r.google?.live ? (["google"] as const) : [])];
  const copy = giveFirstCopy({
    shortName: r.business,
    leadWord: r.leadWord,
    live,
    meta: r.meta ? { ads: r.meta.ads, started: r.meta.started } : null,
    quote: null,
    faults: m.faults,
    pageviews: m.pageviews,
    homePage: true,
    tracking: { siteKind: t.siteKind, gtm: t.gtm.length > 0, gtmEmpty: t.gtmEmpty },
    today: r.today,
  });
  return copy.ok ? `${what} ${copy.copy.steps.replace(/^Here are the steps, if you'd like to do it yourselves\. /, "Here's how. ")}` : what;
}

/** Other things on the site worth changing, never speed: [as a change, as a line for the record]. */
function siteChanges(r: ReviewInput, said: string): [string, string][] {
  const m = r.measurement;
  if (!m) return [];
  const has = (f: Fault) => m.faults.includes(f);
  const out: [string, string][] = [];
  if (has("old_analytics") && !said.includes("Universal Analytics")) {
    out.push([
      "Swap the old Google Analytics for GA4. The only analytics on the site is Universal Analytics, which stopped recording in July 2023, so nothing is counting your visitors.",
      "The only analytics on the site is Google's old Universal Analytics, which stopped recording in July 2023.",
    ]);
  }
  if (has("phone_not_tappable")) out.push(["Make your phone number tap to call. It shows on the page, but people on a phone can't tap it to ring you.", "Your phone number shows on the page but can't be tapped to ring."]);
  for (const b of m.brokenPages.slice(0, 2)) out.push([`Fix the "${b}" page in your menu, which shows an error.`, `Your "${b}" page in the menu shows an error.`]);
  if (has("not_secure")) out.push(["Fix the site's HTTPS. Browsers warn visitors the site isn't secure.", "Browsers warn visitors the site isn't secure (its HTTPS doesn't work properly)."]);
  if (has("no_mobile_layout")) out.push(["Give the site a phone layout. On a phone it shows the desktop page shrunk down, so people pinch and zoom.", "The site has no phone layout."]);
  return out;
}

function competitorLines(r: ReviewInput): string[] {
  const c = r.competitors;
  if (!c) return ["Who else near you is advertising", "[Kyle: the competitor search hasn't run yet. The PC run does it the morning after a yes, so check back tomorrow, or delete this part.]"];
  const out = [`What other ${c.service} businesses near you are running`];
  const n = c.competitors.length;
  if (!n) {
    out.push(`[Kyle: Pulse's search found no other ${c.service} businesses with Facebook ads around ${c.area}. Have a quick look in Meta's Ad Library yourself, or delete this part.]`);
    return out;
  }
  out.push(`At least ${numberWord(n)} other ${c.service} business${n === 1 ? "" : "es"} around ${c.area} ${n === 1 ? "has" : "have"} Facebook ads running:`);
  for (const x of c.competitors) {
    const run = x.started ? (x.ads === 1 ? `, in an ad running since ${longDate(x.started)}` : `, across ${numberWord(x.ads)} ads, the earliest since ${longDate(x.started)}`) : x.ads > 1 ? `, across ${numberWord(x.ads)} ads` : "";
    out.push(`• ${x.name}${x.suburb ? `, in ${x.suburb},` : ""} leads with "${x.quote}"${run}.`);
  }
  out.push(`[Kyle: where ${r.business} stands apart from these, in a line or two.]`);
  return out;
}

function recordLines(r: ReviewInput, leftover: string[], said: string): string[] {
  const out: string[] = [];
  if (r.meta?.live) out.push(`• Facebook: ${r.meta.ads === 1 ? "one ad" : `${numberWord(r.meta.ads)} ads`} running to your website${r.meta.started ? `, the earliest since ${longDate(r.meta.started)}` : ""}.`);
  else if (r.meta) out.push("• Facebook: none showing in Meta's Ad Library when we checked.");
  if (r.google?.live) out.push(`• Google: ${r.google.ads === 1 ? "one ad" : `${numberWord(r.google.ads)} ads`} listed for your website${r.google.lastShown ? `, one last shown on ${longDate(r.google.lastShown)}` : ""}.`);
  else if (r.google) out.push("• Google: none showing in Google's Ads Transparency Centre when we checked.");
  if (!r.meta && !r.google) out.push("• [Kyle: no ad-library check is on record; check both libraries before sending.]");

  const m = r.measurement;
  const t = m?.tracking ?? null;
  if (m && t) {
    const has = (f: Fault) => m.faults.includes(f);
    const pixel = t.metaSeen ? "a Meta Pixel" : has("no_meta_pixel") ? "no Meta Pixel" : "no Meta Pixel we could see from outside";
    const old = has("old_analytics");
    const google = t.googleSeen
      ? old
        ? said.includes("Universal Analytics")
          ? "only Google's old Universal Analytics"
          : "the only analytics is Google's old Universal Analytics, which stopped recording in July 2023"
        : "a Google tag"
      : has("no_google_tag")
        ? "no Google tag"
        : "no Google tag we could see from outside";
    const extra = [
      t.gtm.length && t.gtmEmpty ? "Google Tag Manager is installed but empty." : "",
      has("pixel_double") && m.pageviews >= 2 ? `The Pixel on your home page counts each visit ${timesWords(m.pageviews)}.` : "",
    ].filter(Boolean);
    out.push(`• Tracking: ${pixel}, and ${google}.${extra.length ? ` ${extra.join(" ")}` : ""}`);
  }
  for (const l of leftover) if (!(l.includes("Universal Analytics") && out.some((o) => o.includes("Universal Analytics")))) out.push(`• ${l}`);
  return out;
}

const SIGNATURE = `Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078
hartwelldigital.com`;

export function reviewDraft(r: ReviewInput): { subject: string; body: string } {
  const out: string[] = [];
  out.push(`Hi ${greeting(r.firstName)},`, "");
  out.push("Thanks for getting back to us. Here's the review we promised. It's yours to keep either way.", "");

  // ---------- the three things ----------
  const ads = adFindings(r);
  const tracking = trackingChange(r);
  const site = siteChanges(r, tracking ?? "");
  const pool = [ads[0] ?? "[Kyle: the change to the ads themselves you'd make first, and why.]", ...(tracking ? [tracking] : []), ...ads.slice(1), ...site.map((s) => s[0])];
  const changes = pool.slice(0, 3);
  out.push(`The ${numberWord(changes.length)} thing${changes.length === 1 ? "" : "s"} we'd change first`);
  changes.forEach((c, i) => out.push(`${i + 1}. ${c}`));
  out.push("");

  // ---------- who else is advertising ----------
  out.push(...competitorLines(r), "");

  // ---------- for the record ----------
  const leftover = site.filter((s) => !changes.includes(s[0])).map((s) => s[1]);
  out.push("For the record", ...recordLines(r, leftover, changes.join(" ")), "");

  out.push(
    "None of this needs us. If you'd like a hand with any of it, reply and we'll set out what we'd do and the fixed monthly fee for it, in writing. It's set by the job, not a percentage of what you spend on ads.",
    "",
    SIGNATURE,
  );
  return { subject: `Your free ads review, ${r.business}`, body: out.join("\n") };
}
