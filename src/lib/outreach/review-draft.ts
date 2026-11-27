/**
 * The free ads review, drafted by Pulse for Kyle to finish (Kyle, 27 November
 * 2026: "Yes let's do that"). Every Draper email offers one, written within
 * two working days of a yes. This is the first draft, from what Pulse holds:
 * the ad-library checks (Pulse's own reading of the page text), the newest
 * measurement of their site with its tracking facts, and the give-first fix
 * and steps. It never sends: Kyle copies it, edits it in kyle@'s Gmail and
 * sends it himself.
 *
 * What only Kyle can judge (the ads themselves: offer, picture, audience) is
 * left as bracketed lines for him to write or delete. Everything else is a
 * fact Pulse measured, worded the way the emails word them. Brand rules: we,
 * no fee or figure about what we charge (a fixed monthly fee, set by the job,
 * not a percentage of ad spend, in writing), Australian English, no dashes in
 * sentences. Pure; review-draft.test.ts.
 */
import type { Fault } from "./rules.ts";
import type { TrackingFacts } from "./measure-rules.ts";
import { greeting } from "./render.ts";
import { giveFirstCopy, LEAD, plainText, type LeadWord } from "./give-first.ts";
import { secondsWords } from "./tokens.ts";
import { libraryDate } from "./ads-rules.ts";

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
    lcpMs: number | null;
    fcpMs: number | null;
    pageviews: number;
    brokenPages: string[];
    tracking: TrackingFacts | null;
  } | null;
  /** Melbourne date, YYYY-MM-DD. */
  today: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "24 September 2025". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] ?? ""} ${y}`;
}

/**
 * The opening words of each live ad pointing at their site, with when it
 * started, from the Ad Library's text (the libraries' bold letters made
 * plain). At most `max`, each cut to about a line.
 */
export function liveAdLines(pageText: string, domain: string, max = 3): { text: string; started: string | null }[] {
  const t = pageText.replace(/\r/g, "");
  const starts = [...t.matchAll(/(?:^|\n)\s*(Active|Inactive)\s*\n\s*Library ID:?\s*(\d{6,})/g)];
  const out: { text: string; started: string | null }[] = [];
  for (let i = 0; i < starts.length && out.length < max; i++) {
    const m = starts[i];
    if (m[1] !== "Active") continue;
    const card = t.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : t.length);
    if (!card.toLowerCase().includes(domain.toLowerCase())) continue;
    const lines = card.split("\n").map((l) => plainText(l)).filter(Boolean);
    const at = lines.indexOf("Sponsored");
    let text = at >= 0 ? (lines[at + 1] ?? "") : "";
    if (!text || /^[A-Z0-9-]+(\.[A-Z]{2,})+$/.test(text)) continue;
    if (text.length > 110) text = `${text.slice(0, 107).replace(/\s+\S*$/, "")}...`;
    if (out.some((o) => o.text === text)) continue;
    const started = /Started running on\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})/.exec(card);
    out.push({ text, started: started ? libraryDate(started[1]) : null });
  }
  return out;
}

/** How Google grades the main content's load time on a phone. */
function lcpGrade(ms: number): string {
  if (ms <= 2500) return "which Google counts as good";
  if (ms <= 4000) return "which Google says needs improvement";
  return "which Google counts as slow";
}

const SIGNATURE = `Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078
hartwelldigital.com`;

export function reviewDraft(r: ReviewInput): { subject: string; body: string } {
  const L = LEAD[r.leadWord];
  const m = r.measurement;
  const t = m?.tracking ?? null;
  const has = (f: Fault) => !!m?.faults.includes(f);
  const out: string[] = [];

  out.push(`Hi ${greeting(r.firstName)},`, "");
  out.push(
    "Thanks for getting back to us. Here's the review we promised: what we can see from the outside, what we'd change, and in what order. It's yours to keep either way.",
    "",
  );

  // ---------- the ads ----------
  out.push("What your ads are doing");
  const adBits: string[] = [];
  if (r.meta?.live) {
    adBits.push(
      `• Facebook: ${r.meta.ads === 1 ? "one ad is" : `${r.meta.ads} ads are`} running to your website${r.meta.started ? `, the earliest since ${longDate(r.meta.started)}` : ""}.`,
    );
    for (const a of r.domain ? liveAdLines(r.meta.pageText, r.domain) : []) adBits.push(`  "${a.text}"${a.started ? ` (running since ${longDate(a.started)})` : ""}`);
  } else if (r.meta) {
    adBits.push("• Facebook: Meta's Ad Library showed no ads running to your website when we checked.");
  }
  if (r.google?.live) {
    adBits.push(`• Google: ${r.google.ads === 1 ? "one ad is" : `${r.google.ads} ads are`} listed for your website${r.google.lastShown ? `, one last shown on ${longDate(r.google.lastShown)}` : ""}.`);
  } else if (r.google) {
    adBits.push("• Google: Google's Ads Transparency Centre showed no recent ads for your website when we checked.");
  }
  out.push(...(adBits.length ? adBits : ["• [Kyle: no ad-library check is on record; check both libraries before writing this part.]"]));
  out.push("[Kyle: your read of the ads themselves: the offer, the picture, who they seem aimed at, and the one change you'd make first.]", "");

  // ---------- the tracking ----------
  out.push("What measures them");
  if (!t) {
    out.push("• [Kyle: Pulse has no tracking reading for this site; measure its home page again on the Draper page.]");
  } else {
    out.push(`• Meta Pixel: ${t.metaSeen ? "on the site." : has("no_meta_pixel") ? "not on the site, so Facebook can't tell which clicks turned into " + L.plural + "." : "we couldn't tell from outside."}`);
    out.push(
      `• Google tag: ${t.googleSeen ? (has("old_analytics") ? "only the old Universal Analytics, which stopped recording in July 2023." : "on the site.") : has("no_google_tag") ? `not on the site, so Google can't tell which clicks turned into ${L.plural}.` : "we couldn't tell from outside."}`,
    );
    if (t.gtm.length) out.push(`• Google Tag Manager: installed${t.gtmEmpty ? ", but empty: nothing in it is measuring anything." : "."}`);
    if (has("pixel_double")) out.push(`• The Meta Pixel on your home page counts each visit ${m!.pageviews >= 3 ? "more than twice" : "twice"}, so the numbers you judge your ads by start out wrong.`);
  }
  out.push("");

  // ---------- the site ----------
  out.push("What someone meets when they click");
  const site: string[] = [];
  if (m?.lcpMs != null) site.push(`• In Google's own speed test on a phone, the page took ${secondsWords(m.lcpMs)} to show its main content, ${lcpGrade(m.lcpMs)}.`);
  if (has("layout_shift")) site.push("• The page jumps about while it loads (in Google's poor range), so people tap the wrong thing.");
  if (has("page_freezes")) site.push("• After it appears, the page is too busy to answer a tap for a stretch (in Google's poor range).");
  if (has("phone_not_tappable")) site.push("• Your phone number shows on the page but can't be tapped to ring on a phone.");
  if (has("no_mobile_layout")) site.push("• The page has no phone layout, so a phone shows the desktop page shrunk down.");
  if (has("not_secure")) site.push("• Browsers warn visitors the site isn't secure (its HTTPS doesn't work properly).");
  for (const b of m?.brokenPages ?? []) site.push(`• Your "${b}" page in the menu shows an error.`);
  out.push(...(site.length ? site : ["• Nothing on the page itself stood out."]), "");

  // ---------- what we'd change ----------
  out.push("What we'd change, in order");
  const steps: string[] = [];
  if (m && t) {
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
    if (copy.ok) steps.push(`Measure what the ads bring in. ${copy.copy.steps.replace(/^Here are the steps, if you'd like to do it yourselves\. /, "")}`);
  }
  if (has("old_analytics") && !steps.some((s) => s.includes("Universal Analytics"))) steps.push("Replace the old Universal Analytics tag with Google Analytics 4, so the site's visits are counted again.");
  if (has("phone_not_tappable")) steps.push("Make the phone number a tap-to-call link, so people on a phone can ring in one tap.");
  if (has("not_secure")) steps.push("Fix the site's HTTPS certificate, so browsers stop warning visitors.");
  if ((m?.brokenPages ?? []).length) steps.push("Fix or remove the menu pages that show an error.");
  if ((m?.lcpMs ?? 0) > 4000 || has("page_freezes") || has("layout_shift")) {
    steps.push("Make the page people land on lighter: smaller images, fewer scripts and sliders, so it shows and answers quickly on a phone.");
  }
  if (has("no_mobile_layout")) steps.push("Give the site a phone layout.");
  steps.push("[Kyle: the change to the ads themselves you'd make first.]");
  steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
  out.push("");

  out.push(
    "None of this needs us. If you'd like a hand with any of it, reply and we'll set out what we'd do and the fixed monthly fee for it, in writing. It's set by the job, not a percentage of what you spend on ads.",
    "",
    SIGNATURE,
  );
  return { subject: `Your free ads review, ${r.business}`, body: out.join("\n") };
}
