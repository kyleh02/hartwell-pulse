/**
 * Template 4, give first (Kyle, 27 November 2026): Pulse's own copy, the
 * checks on what the morning run types, and the whole submit decision, tested
 * against the paper test's real businesses (made anonymous where it matters).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuote, giveFirstCopy, plainText, possessive, quoteProblem, shortNameProblem, sinceWords, type GiveFirstFacts } from "./give-first.ts";
import { verifyGiveFirst, type GiveFirstContext } from "./verify-give-first.ts";
import { isGiveFirstTemplate, needsLiveAds, renderGiveFirst } from "./render.ts";
import { TEMPLATE_GIVE_FIRST } from "./template-give-first.ts";
import { libraryDate } from "./ads-rules.ts";
import type { TrackingFacts } from "./measure-rules.ts";

const T = { ...TEMPLATE_GIVE_FIRST, version: 4 };

const base: GiveFirstFacts = {
  shortName: "Coastal Tint Co",
  leadWord: "quotes",
  live: ["meta"],
  meta: { ads: 4, started: "2025-05-29" },
  quote: null,
  faults: ["no_meta_pixel"],
  pageviews: 0,
  homePage: true,
  tracking: { siteKind: "wordpress", gtm: true, gtmEmpty: false },
  today: "2026-11-27",
};

function copyOf(f: Partial<GiveFirstFacts>) {
  const r = giveFirstCopy({ ...base, ...f });
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.copy;
}

test("since: this year, last year, or the year", () => {
  assert.equal(sinceWords("2026-03-23", "2026-11-27"), "March");
  assert.equal(sinceWords("2025-05-29", "2026-11-27"), "May last year");
  assert.equal(sinceWords("2023-07-30", "2026-11-27"), "July 2023");
  assert.equal(possessive("Southeast Fibreglass"), "Southeast Fibreglass's");
});

test("the template's example is exactly what Pulse writes", () => {
  const c = copyOf({});
  const r = renderGiveFirst(T, { firstName: null, optOut: "A", ...c });
  assert.deepEqual(r.problems, []);
  assert.equal(`Subject: ${r.first.subject}\n\n${r.first.body}`, T.example);
  assert.equal(c.lead, "no_meta_pixel");
  assert.deepEqual(c.claimed, ["no_meta_pixel"]);
  assert.match(r.followUp.body, /^Hi there,\n\nHere are the steps, if you'd like to do it yourselves\. In Meta Events Manager, create a Pixel/);
  assert.match(r.followUp.body, /a second tag that sends a Lead event when your quote form is sent\./);
  assert.match(r.followUp.body, /The free ads review still stands\. If you'd like one, let us know/);
  assert.equal(r.followUp.subject, "Re: can Facebook see Coastal Tint Co's quotes?");
});

test("a quote names the ad and how long it has run", () => {
  const c = copyOf({ shortName: "Caravan and Trailer Clinic", leadWord: "bookings", meta: { ads: 1, started: "2025-09-24" }, quote: { text: "Now open in our new workshop", started: "2025-09-24" } });
  assert.equal(
    c.finding,
    'Your Facebook ad that says "Now open in our new workshop" has run since September last year and sends people to your website, but the site has no Meta Pixel on it. So Facebook can\'t tell which of those clicks turned into bookings, and can only aim your ad at people likely to click, not people likely to book.',
  );
  assert.equal(c.subjectTail, "Caravan and Trailer Clinic's bookings");
});

test("Black Diamond: a hand-built site, no Pixel, and only the old analytics", () => {
  const c = copyOf({ shortName: "Black Diamond Tinting", meta: { ads: 3, started: "2026-03-23" }, faults: ["no_meta_pixel", "old_analytics"], tracking: { siteKind: "other", gtm: false, gtmEmpty: false } });
  assert.equal(
    c.finding,
    "Your Facebook ads have sent people to your website since March, but the site has no Meta Pixel on it. The only analytics on it is Google's old Universal Analytics, which stopped recording in July 2023. So Facebook can't tell which of those clicks turned into quote requests, and can only aim your ads at people likely to click, not people likely to ask for a quote.",
  );
  assert.equal(c.fix, "Here's the fix: the Pixel's code and a current Google Analytics tag go in your website's header, with one line that tells Facebook when someone sends your quote form.");
  assert.match(c.steps, /the old Universal Analytics code can come out, with a Google Analytics 4 tag in its place\.$/);
  assert.deepEqual(c.claimed, ["no_meta_pixel", "old_analytics"]);
});

test("Southeast Fibreglass: both platforms live, an empty tag manager", () => {
  const c = copyOf({ shortName: "Southeast Fibreglass", live: ["google", "meta"], faults: ["no_meta_pixel", "no_google_tag", "slow_mobile"], tracking: { siteKind: "wordpress", gtm: true, gtmEmpty: true } });
  assert.equal(c.gapPlatform, "Google and Facebook");
  assert.equal(
    c.finding,
    "Your Google and Facebook ads send people to your website, but the site has no Meta Pixel and no Google tag on it. The Google tag manager on it is installed but empty. So neither Google nor Facebook can tell which of those clicks turned into quote requests, or aim your ads at people likely to ask for a quote.",
  );
  assert.match(c.fix, /^Here's the fix: your tag manager is already on every page/);
  assert.deepEqual(c.claimed, ["no_meta_pixel", "no_google_tag"]);
  const r = renderGiveFirst(T, { firstName: "Sam", optOut: "B", ...c });
  assert.deepEqual(r.problems, []);
  assert.equal(r.first.subject, "can Google and Facebook see Southeast Fibreglass's quotes?");
  assert.match(r.first.body, /^Hi Sam,/);
  assert.ok(r.followUp.body.includes(T.opt_out_b));
});

test("Google only, a doubled Pixel, and a Shopify or site-builder fix", () => {
  const g = copyOf({ live: ["google"], faults: ["no_google_tag"], tracking: { siteKind: "duda", gtm: false, gtmEmpty: false } });
  assert.equal(g.gapPlatform, "Google");
  assert.match(g.fix, /your site builder has a place in its settings for Google's tag/);
  const d = copyOf({ faults: ["pixel_double"], pageviews: 2 });
  assert.equal(d.lead, "pixel_double");
  assert.match(d.finding, /the Meta Pixel on your home page counts each visit twice\./);
  const s = copyOf({ tracking: { siteKind: "shopify", gtm: false, gtmEmpty: false } });
  assert.equal(s.fix, "Here's the fix: connecting Shopify's Facebook and Instagram app adds the Pixel to every page of your store.");
  const w = copyOf({ tracking: { siteKind: "wix", gtm: false, gtmEmpty: false } });
  assert.equal(w.fix, "Here's the fix: your site builder has a place in its settings for the Pixel, along with one line that tells Facebook when someone sends your quote form.");
});

test("nothing to write: no gap, or a gap on a platform their ads don't run on", () => {
  for (const f of [
    { faults: ["slow_mobile", "phone_not_tappable"] },
    { live: ["google"], faults: ["no_meta_pixel"] },
    { live: ["meta"], faults: ["no_google_tag"] },
    { faults: ["pixel_double"], pageviews: 2, homePage: false },
  ] as Partial<GiveFirstFacts>[]) {
    const r = giveFirstCopy({ ...base, ...f });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /no tracking gap/);
  }
});

test("every version of the copy keeps the house rules", () => {
  const kinds = ["wordpress", "shopify", "wix", "other"] as const;
  const banned = /[—–!]|\s-\s|\b(leverage|seamless|robust|comprehensive|actionable|cutting-edge|innovative|elevate|streamline|unlock|harness|simple|quick|easy|mobile|currently|guarantee|optimi[sz]e)\b/i;
  for (const siteKind of kinds) {
    for (const gtm of [true, false]) {
      for (const f of [
        { faults: ["no_meta_pixel"] },
        { faults: ["no_meta_pixel", "old_analytics"] },
        { live: ["google"], faults: ["no_google_tag"] },
        { live: ["google", "meta"], faults: ["no_meta_pixel", "no_google_tag"] },
        { faults: ["pixel_double"], pageviews: 3 },
      ] as Partial<GiveFirstFacts>[]) {
        for (const leadWord of ["quotes", "bookings", "enquiries"] as const) {
          const c = copyOf({ ...f, leadWord, tracking: { siteKind, gtm, gtmEmpty: false } });
          const r = renderGiveFirst(T, { firstName: null, optOut: "A", ...c });
          assert.deepEqual(r.problems, []);
          for (const text of [c.finding, c.fix, c.steps, r.first.subject]) assert.doesNotMatch(text, banned, text);
          // A short first email: about 150 words before the signature.
          const words = r.first.body.split("Kyle Hartwell")[0].split(/\s+/).filter(Boolean).length;
          assert.ok(words <= 175, `${words} words: ${r.first.body}`);
        }
      }
    }
  }
});

test("the short name is the business's own", () => {
  assert.equal(shortNameProblem("Black Diamond Tinting", "Black Diamond Tinting Co."), null);
  assert.equal(shortNameProblem("Southeast Fibreglass", "Southeast Fibreglass Services"), null);
  assert.equal(shortNameProblem("The Tint Joint", "The Tint Joint"), null);
  assert.match(shortNameProblem("Suncoast Fibreglass", "Southeast Fibreglass Services") ?? "", /own name/);
  assert.match(shortNameProblem("Black Diamond Pty Ltd", "Black Diamond Pty Ltd") ?? "", /Pty Ltd/);
  assert.match(shortNameProblem("Tint!", "Tint") ?? "", /characters/);
});

const LIBRARY = `Ad Library
~4 results
Active
Library ID: 1234567890123456
Started running on Sep 24, 2025
Platforms
See ad details
Caravan and Trailer Clinic Geelong
Sponsored
𝗛𝗘𝗟𝗟𝗢 𝗔𝗟𝗟 𝗔𝗡𝗗 𝗪𝗘𝗟𝗖𝗢𝗠𝗘. 𝗡𝗢𝗪 𝗢𝗣𝗘𝗡 𝗜𝗡 𝗢𝗨𝗥 𝗡𝗘𝗪 𝗪𝗢𝗥𝗞𝗦𝗛𝗢𝗣 𝗟𝗢𝗖𝗔𝗧𝗘𝗗 𝗜𝗡 𝗕𝗥𝗘𝗔𝗞𝗪𝗔𝗧𝗘𝗥!
At Caravan and Trailer Clinic Geelong, we take the hassle out of servicing.
CTCGEELONG.COM.AU
Stay safe. Stay reliable. Stay road-ready.
Contact us
Inactive
Library ID: 9999999999999999
Started running on Jan 2, 2024
Caravan and Trailer Clinic Geelong
Sponsored
Winter special on caravan services
CTCGEELONG.COM.AU`;

test("a quote must be words of a live ad pointing to their site", () => {
  assert.equal(plainText("𝗡𝗢𝗪 𝗢𝗣𝗘𝗡"), "NOW OPEN");
  const ok = findQuote(LIBRARY, "ctcgeelong.com.au", "Now open in our new workshop", libraryDate);
  assert.deepEqual(ok, { ok: true, started: "2025-09-24" });
  assert.equal(findQuote(LIBRARY, "ctcgeelong.com.au", "Stay safe stay reliable", libraryDate).ok, false); // full stops in the ad
  assert.equal(findQuote(LIBRARY, "ctcgeelong.com.au", "Winter special on caravan services", libraryDate).ok, false); // inactive
  assert.equal(findQuote(LIBRARY, "other.com.au", "Now open in our new workshop", libraryDate).ok, false);
  assert.match(quoteProblem("Tinting from $150 today") ?? "", /plain words/);
  assert.match(quoteProblem("Now open") ?? "", /three to eight/);
});

test("the give-first template is told apart from the others", () => {
  assert.equal(isGiveFirstTemplate(T), true);
  assert.equal(needsLiveAds(T), true);
});

// ---------- the whole submit decision ----------

const tracking: TrackingFacts = { siteKind: "wordpress", gtm: ["GTM-WDRK65K"], gtmRead: true, gtmEmpty: false, metaSeen: false, googleSeen: true, consent: false };

function ctx(over: Partial<GiveFirstContext> = {}): GiveFirstContext {
  return {
    prospect: { id: "p1", status: "measured", suburb: "Berwick", postcode: "3806", lane_id: 1, business_name: "The Tint Joint", domain: "berwickwindowtinting.com.au" },
    contact: { email: "info@berwickwindowtinting.com.au", first_name: null, address_kind: "generic", mx_provider: "google" },
    lane: { id: 1, template_version: 4, approval_required: true, active: true },
    template: T,
    settings: { version: 3, opt_out_line: "A" },
    faultsOff: [],
    measurements: [
      {
        id: "m1",
        prospect_id: "p1",
        url: "https://www.berwickwindowtinting.com.au/",
        status: "ok",
        measured_at: "2026-11-27T21:00:00Z",
        psi_fcp_ms: 2100,
        psi_lcp_ms: 3900,
        menu_links: [],
        pixel_pageviews: {},
        ad_signal: false,
        faults: ["no_meta_pixel"],
        tracking,
      },
    ],
    existingMessages: 0,
    refusals: 0,
    ads: { platforms: ["meta"], checkedAt: "2026-11-27T20:40:00Z" },
    gstRegistered: true,
    meta: { ads: 4, started: "2025-05-29", pageText: "" },
    today: "2026-11-27",
    ...over,
  };
}

test("an accepted give-first draft: both emails, the claims, and approval on", () => {
  const v = verifyGiveFirst(ctx(), { prospect_id: "p1", template_version: 4, short_name: "The Tint Joint", lead_word: "quotes" });
  assert.ok(v.ok, v.ok ? "" : v.reasons.join(" | "));
  assert.equal(v.first.subject, "can Facebook see The Tint Joint's quotes?");
  assert.equal(v.first.fault, "no_meta_pixel");
  assert.equal(v.first.needs_approval, true);
  assert.ok(v.followUp);
  assert.equal(v.followUp!.fault, "no_meta_pixel");
  assert.deepEqual(
    v.claims.map((c) => [c.message, c.fault, c.slot]),
    [
      ["first", "no_meta_pixel", "finding"],
      ["follow_up", "no_meta_pixel", "second_finding"],
    ],
  );
  assert.equal(v.first.slots.claimed, "no_meta_pixel");
});

test("the give-first refusals", () => {
  const go = (c: Partial<GiveFirstContext>, i: Record<string, string> = {}) => {
    const v = verifyGiveFirst(ctx(c), { prospect_id: "p1", template_version: 4, short_name: "The Tint Joint", lead_word: "quotes", ...i });
    assert.equal(v.ok, false);
    return v.ok ? "" : v.reasons.join(" | ");
  };
  assert.match(go({ ads: { platforms: [], checkedAt: null } }), /no live ads/);
  assert.match(go({ gstRegistered: false }), /GST/);
  assert.match(go({}, { short_name: "Tint Masters" }), /own name/);
  assert.match(go({}, { lead_word: "calls" }), /lead_word/);
  assert.match(go({ measurements: ctx().measurements.map((m) => ({ ...m, faults: ["slow_mobile"] })) }), /no tracking gap/);
  assert.match(go({ measurements: ctx().measurements.map((m) => ({ ...m, tracking: null })) }), /Measure its home page again/);
  assert.match(go({ ads: { platforms: ["google"], checkedAt: "2026-11-27T20:40:00Z" } }), /no tracking gap/);
  assert.match(go({ faultsOff: ["no_meta_pixel"] }), /no tracking gap/);
  assert.match(go({ existingMessages: 2 }), /One approach per business/);
  assert.match(go({}, { ad_quote: "Something they never said here" }), /isn't in the text/);
});
