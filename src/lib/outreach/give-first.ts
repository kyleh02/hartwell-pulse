/**
 * Template 4, "give first" (Kyle, 27 November 2026). The paper test that day
 * ("Draper paper test, 27 Nov 2026.md" in Drive) found one finding strong
 * enough to write to a business about: ads running to a website that can't
 * measure them. Kyle made the changes the rules the same day:
 *
 *  - only a tracking gap on a platform their ads run on leads an email (a Meta
 *    Pixel missing with Facebook ads live, a Google tag missing with Google ads
 *    live, or a Pixel counting each visit more than once);
 *  - the fix goes in the first email, in plain words, so even an owner who
 *    never replies gets something useful from us;
 *  - the second email gives the exact steps for their kind of site;
 *  - the offer is a free ads review, with the reason it's free, asked as a
 *    friendly question; no proof line.
 *
 * The wording here is Kyle's approved copy, filled only from Pulse's own
 * records (the measurement, its tag manager containers, the ad-library
 * checks), so every sentence is one Pulse can prove. Nothing in it is typed
 * by the morning run except the business's short name, the word for what
 * their customers send (checked against a fixed list) and, optionally, the
 * words of one of their ads (checked against the library's text).
 * Pure; give-first.test.ts.
 */
import type { Fault } from "./rules.ts";
import type { AdPlatform } from "./ads-rules.ts";
import type { SiteKind } from "./measure-rules.ts";
import { nameKey, timesWords } from "./tokens.ts";

export const LEAD_WORDS = ["quotes", "bookings", "enquiries"] as const;
export type LeadWord = (typeof LEAD_WORDS)[number];

/** How each word reads in the email. */
export const LEAD: Record<LeadWord, { plural: string; verb: string; form: string; subject: string }> = {
  quotes: { plural: "quote requests", verb: "ask for a quote", form: "quote form", subject: "quotes" },
  bookings: { plural: "bookings", verb: "book", form: "booking form", subject: "bookings" },
  enquiries: { plural: "enquiries", verb: "get in touch", form: "contact form", subject: "enquiries" },
};

export interface GiveFirstFacts {
  /** The business's short name, already checked against its own name. */
  shortName: string;
  leadWord: LeadWord;
  /** Platforms with live ads, from fresh ad-library checks. */
  live: AdPlatform[];
  /** The Meta check: how many active ads point at their site, and when the earliest started (YYYY-MM-DD). */
  meta: { ads: number; started: string | null } | null;
  /** A few words of one of their live Facebook ads, already checked, and when that ad started. */
  quote: { text: string; started: string | null } | null;
  /** Faults on the measurement behind the email, less any switched off. */
  faults: Fault[];
  /** The most times the Pixel counted one visit on that measurement. */
  pageviews: number;
  /** That measurement is of the home page. */
  homePage: boolean;
  tracking: { siteKind: SiteKind; gtm: boolean; gtmEmpty: boolean };
  /** Melbourne date, YYYY-MM-DD. */
  today: string;
}

export interface GiveFirstCopy {
  /** The fault the emails are about: the message's own fault, re-checked before each one goes. */
  lead: Fault;
  /** Every fault the first email states. All must still hold when it sends. */
  claimed: Fault[];
  /** The subject's platform: where the gap is and the ads run. */
  gapPlatform: string;
  /** The subject's "Black Diamond Tinting's quotes". */
  subjectTail: string;
  finding: string;
  fix: string;
  steps: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "March", "May last year" or "July 2023", from a YYYY-MM-DD start and today. */
export function sinceWords(started: string, today: string): string {
  const [y, m] = started.split("-").map(Number);
  const ty = Number(today.slice(0, 4));
  const month = MONTHS[m - 1] ?? "";
  if (y === ty) return month;
  if (y === ty - 1) return `${month} last year`;
  return `${month} ${y}`;
}

/** "Black Diamond Tinting's". */
export function possessive(name: string): string {
  return `${name.trim()}'s`;
}

type Builder = "gtm" | "shopify" | "site builder" | "header";

function builderOf(t: GiveFirstFacts["tracking"]): Builder {
  if (t.gtm) return "gtm";
  if (t.siteKind === "shopify") return "shopify";
  if (t.siteKind === "wix" || t.siteKind === "squarespace" || t.siteKind === "duda" || t.siteKind === "webflow") return "site builder";
  return "header";
}

const STEPS_OPEN = "Here are the steps, if you'd like to do it yourselves.";
const TEST_EVENTS = "the Test Events tab in Events Manager shows it working.";

/**
 * The give-first emails' own sentences, or why there's nothing to write. The
 * order Kyle's rules give: both platforms blind, then Facebook, then Google,
 * then a Pixel counting twice. Nothing else leads a give-first email.
 */
export function giveFirstCopy(f: GiveFirstFacts): { ok: true; copy: GiveFirstCopy } | { ok: false; reason: string } {
  const has = (x: Fault) => f.faults.includes(x);
  const metaLive = f.live.includes("meta");
  const googleLive = f.live.includes("google");
  const metaGap = metaLive && has("no_meta_pixel");
  const googleGap = googleLive && has("no_google_tag");
  const doubled = metaLive && has("pixel_double") && f.homePage && f.pageviews >= 2;
  const L = LEAD[f.leadWord];
  const b = builderOf(f.tracking);
  const old = has("old_analytics");
  const emptyGtm = f.tracking.gtm && f.tracking.gtmEmpty;
  const many = (f.meta?.ads ?? 0) !== 1;

  if (metaGap && googleGap) {
    const finding = [
      "Your Google and Facebook ads send people to your website, but the site has no Meta Pixel and no Google tag on it.",
      emptyGtm ? "The Google tag manager on it is installed but empty." : "",
      `So neither Google nor Facebook can tell which of those clicks turned into ${L.plural}, or aim your ads at people likely to ${L.verb}.`,
    ].filter(Boolean).join(" ");
    const fix =
      b === "gtm"
        ? `Here's the fix: your tag manager is already on every page, so the Pixel and Google's conversion tag can both go straight in there, each set to count your ${L.form}.`
        : b === "site builder"
          ? `Here's the fix: your site builder has a place in its settings for the Pixel and Google's tag, each set to count your ${L.form}.`
          : `Here's the fix: the Pixel and Google's tag go in your website's header, each set to count your ${L.form}.`;
    const steps =
      b === "gtm"
        ? `${STEPS_OPEN} In Google Tag Manager, add a Meta Pixel tag (its ID is in Meta Events Manager) and a Conversion Linker tag, both firing on every page. Then add a Lead event for Facebook and a Google Ads Conversion Tracking tag (its ID and label are in your Google Ads account), both firing when your ${L.form} is sent, and publish.`
        : `${STEPS_OPEN} Copy the Pixel's base code from Meta Events Manager and the Google tag from your Google Ads account into ${b === "site builder" ? "the header code box in your site builder's settings" : "the header of every page"}. Then set a Lead event for Facebook and a conversion for Google on the page or message people see after sending your ${L.form}.`;
    return ok("no_meta_pixel", ["no_meta_pixel", "no_google_tag"], "Google and Facebook", finding, fix, steps);
  }

  if (metaGap) {
    let opener: string;
    if (f.quote) {
      opener = f.quote.started
        ? `Your Facebook ad that says "${f.quote.text}" has run since ${sinceWords(f.quote.started, f.today)} and sends people to your website`
        : `Your Facebook ad that says "${f.quote.text}" sends people to your website`;
    } else if (f.meta?.started) {
      opener = `Your Facebook ${many ? "ads have" : "ad has"} sent people to your website since ${sinceWords(f.meta.started, f.today)}`;
    } else {
      opener = `Your Facebook ${many ? "ads send" : "ad sends"} people to your website`;
    }
    const adsWord = f.quote || !many ? "ad" : "ads";
    const finding = [
      `${opener}, but the site has no Meta Pixel on it.`,
      old ? "The only analytics on it is Google's old Universal Analytics, which stopped recording in July 2023." : emptyGtm ? "The Google tag manager on it is installed but empty." : "",
      `So Facebook can't tell which of those clicks turned into ${L.plural}, and can only aim your ${adsWord} at people likely to click, not people likely to ${L.verb}.`,
    ].filter(Boolean).join(" ");
    const line = `with one line that tells Facebook when someone sends your ${L.form}`;
    const fix =
      b === "gtm"
        ? old
          ? `Here's the fix: your site already has Google's tag manager, so the Pixel and a current Google Analytics tag can both go straight in there, ${line}.`
          : `Here's the fix: your site already has Google's tag manager, so the Pixel can go straight in there, ${line}.`
        : b === "shopify"
          ? `Here's the fix: connecting Shopify's Facebook and Instagram app adds the Pixel to every page of your store.${old ? " Google's own Shopify app puts current Google Analytics in place of the old tag." : ""}`
          : b === "site builder"
            ? `Here's the fix: your site builder has a place in its settings for the Pixel, along ${line}.${old ? " A current Google Analytics tag can go in beside it, in place of the old one." : ""}`
            : old
              ? `Here's the fix: the Pixel's code and a current Google Analytics tag go in your website's header, ${line}.`
              : `Here's the fix: the Pixel's code goes in your website's header, ${line}.`;
    const oldStep = old ? " While you're in there, the old Universal Analytics code can come out, with a Google Analytics 4 tag in its place." : "";
    const steps =
      b === "gtm"
        ? `${STEPS_OPEN} In Meta Events Manager, create a Pixel and copy its ID. In Google Tag Manager, add a Meta Pixel tag with that ID that fires on every page, and a second tag that sends a Lead event when your ${L.form} is sent. Publish, and ${TEST_EVENTS}${oldStep}`
        : b === "shopify"
          ? `${STEPS_OPEN} In Shopify, add the Facebook and Instagram sales channel, connect your Facebook account, and choose your Pixel or create one there. Then the Test Events tab in Meta Events Manager shows it working.${oldStep}`
          : b === "site builder"
            ? `${STEPS_OPEN} In Meta Events Manager, create a Pixel and copy its ID or base code into the Pixel or header code box in your site builder's settings. Then set a Lead event for the page or message people see after sending your ${L.form}, and ${TEST_EVENTS}${oldStep}`
            : `${STEPS_OPEN} In Meta Events Manager, create a Pixel and copy its base code into the header of every page on your site. Then add a Lead event to the page or message people see after sending your ${L.form}, and ${TEST_EVENTS}${oldStep}`;
    return ok("no_meta_pixel", ["no_meta_pixel", ...(old ? (["old_analytics"] as Fault[]) : [])], "Facebook", finding, fix, steps);
  }

  if (googleGap) {
    const finding = [
      "Your Google ads send people to your website, but the site has no Google tag on it.",
      emptyGtm ? "The Google tag manager on it is installed but empty." : "",
      `So Google can't tell which of those clicks turned into ${L.plural}, and can only aim your ads at people likely to click, not people likely to ${L.verb}.`,
    ].filter(Boolean).join(" ");
    const fix =
      b === "gtm"
        ? `Here's the fix: your site already has Google's tag manager, so a Google Ads conversion tag can go straight in there, set to count each ${L.form} sent.`
        : b === "site builder"
          ? `Here's the fix: your site builder has a place in its settings for Google's tag, along with a conversion that counts each ${L.form} sent.`
          : `Here's the fix: Google's tag goes in your website's header, with a conversion that counts each ${L.form} sent.`;
    const steps =
      b === "gtm"
        ? `${STEPS_OPEN} In your Google Ads account, create a conversion for your ${L.form} and note its ID and label. In Google Tag Manager, add a Google Ads Conversion Tracking tag with them that fires when the form is sent, and a Conversion Linker tag on every page. Publish, and Google Ads starts counting them.`
        : `${STEPS_OPEN} In your Google Ads account, create a conversion for your ${L.form} and choose to add the tag yourself. Put the Google tag in ${b === "site builder" ? "the header code box in your site builder's settings" : "the header of every page"}, and the event snippet on the page or message people see after sending the form.`;
    return ok("no_google_tag", ["no_google_tag"], "Google", finding, fix, steps);
  }

  if (doubled) {
    const finding = `Your Facebook ${many ? "ads send" : "ad sends"} people to your website, but the Meta Pixel on your home page counts each visit ${timesWords(f.pageviews)}. So the numbers you judge ${many ? "those ads" : "that ad"} by start out wrong.`;
    const fix = "Here's the fix: the Pixel is installed more than once, and taking out the extra copy sorts it.";
    const steps = `${STEPS_OPEN} Look for the Pixel in your site's header code and in any plugin, app or tag manager that adds it, then keep one and remove the rest. The Test Events tab in Meta Events Manager then shows one page view per visit.`;
    return ok("pixel_double", ["pixel_double"], "Facebook", finding, fix, steps);
  }

  return {
    ok: false,
    reason: 'No tracking gap on a platform their ads run on. Under the give-first template Draper only writes about ads a website can\'t measure: drop it with the reason "no tracking gap".',
  };

  function ok(lead: Fault, claimed: Fault[], gapPlatform: string, finding: string, fix: string, steps: string) {
    return {
      ok: true as const,
      copy: { lead, claimed, gapPlatform, subjectTail: `${possessive(f.shortName)} ${L.subject}`, finding, fix, steps },
    };
  }
}

// ---------- what the morning run types, checked ----------

/** Text as a person reads it: the libraries' bold and italic letters made plain, invisible characters out, spaces single. */
export function plainText(s: string): string {
  return s.normalize("NFKC").replace(/[​-‍⁠﻿]/g, "").replace(/\s+/g, " ").trim();
}

/** Why a short name can't be used, or null. It must be the business's own name, or a run of its words. */
export function shortNameProblem(short: string, businessName: string | null): string | null {
  const s = plainText(short);
  if (s.length < 2 || s.length > 40) return "short_name must be 2 to 40 characters.";
  if (!/^[A-Za-z0-9][A-Za-z0-9 &'’.+-]*$/.test(s)) return "short_name has characters a business name wouldn't.";
  if (/\b(pty|ltd|limited)\b/i.test(s)) return 'short_name leaves out "Pty Ltd": the name people know them by.';
  const want = ` ${nameKey(s)} `;
  const have = ` ${nameKey(businessName)} `;
  if (!nameKey(s) || !have.trim() || !have.includes(want)) {
    return `short_name must be the business's own name or a run of its words ("${businessName ?? "no name on file"}").`;
  }
  return null;
}

/** Why a quote can't be used, or null: three to eight words of an ad's own text, plain. */
export function quoteProblem(quote: string): string | null {
  const q = plainText(quote);
  const words = q.split(" ").filter(Boolean).length;
  if (words < 3 || words > 8) return "ad_quote is three to eight words copied from one of their ads.";
  if (!/^[A-Za-z][A-Za-z ,'’&]*$/.test(q)) return "ad_quote must be plain words: no digits, prices, emoji, dashes, quote marks or punctuation at the end.";
  return null;
}

/**
 * Find a quote in the Ad Library's text: it must be in the text of an ad
 * marked Active whose card shows the business's own domain. Returns when that
 * ad started (YYYY-MM-DD), or what's wrong.
 */
export function findQuote(
  pageText: string,
  domain: string,
  quote: string,
  libraryDate: (s: string) => string | null,
): { ok: true; started: string | null } | { ok: false; problem: string } {
  const bad = quoteProblem(quote);
  if (bad) return { ok: false, problem: bad };
  const want = plainText(quote).toLowerCase();
  const t = pageText.replace(/\r/g, "");
  const starts = [...t.matchAll(/(?:^|\n)\s*(Active|Inactive)\s*\n\s*Library ID:?\s*(\d{6,})/g)];
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i];
    if (m[1] !== "Active") continue;
    const card = t.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : t.length);
    if (!card.toLowerCase().includes(domain.toLowerCase())) continue;
    const lines = card.split("\n").map((l) => plainText(l)).filter(Boolean);
    const at = lines.indexOf("Sponsored");
    const body = at >= 0 ? ` ${lines.slice(at + 1).join(" ").toLowerCase()} ` : "";
    if (!body.includes(` ${want}`)) continue;
    const started = /Started running on\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})/.exec(card);
    return { ok: true, started: started ? libraryDate(started[1]) : null };
  }
  return { ok: false, problem: "ad_quote isn't in the text of any active ad pointing to their website in the Ad Library check on record. Copy the words exactly, or leave it out." };
}
