/**
 * The free ads review Pulse drafts for Kyle (27 November 2026), in the shape
 * Kyle chose the same day: three things to change first, the ads leading;
 * local competitors named; the readings for the record; never site speed;
 * numbers to twenty as words; Kyle's own judgement left in brackets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { liveAdLines, longDate, pastOffer, reviewDraft, runWords, type ReviewInput } from "./review-draft.ts";
import type { CompetitorCheck } from "./competitors-rules.ts";

const LIBRARY = `Active
Library ID: 1111111111111111
Started running on Mar 23, 2026
Black Diamond Tinting Co.
Sponsored
Black Diamond Tinting Co.
BLACKDIAMONDTINTING.COM.AU
Contact us
Active
Library ID: 2222222222222222
Started running on Apr 2, 2026
Black Diamond Tinting Co.
Sponsored
Black Diamond Tinting Co.
BLACKDIAMONDTINTING.COM.AU
Contact us
Active
Library ID: 3333333333333333
Started running on Nov 8, 2026
Black Diamond Tinting Co
Sponsored
𝗦𝘂𝗺𝗺𝗲𝗿 𝗶𝘀 𝗵𝗲𝗿𝗲
BLACKDIAMONDTINTING.COM.AU
Inactive
Library ID: 4444444444444444
Started running on Jan 2, 2025
Black Diamond Tinting Co
Sponsored
An old ad
BLACKDIAMONDTINTING.COM.AU`;

const COMPETITORS: CompetitorCheck = {
  checked_at: "2026-11-28T21:10:00.000Z",
  service: "window tinting",
  area: "the Gold Coast",
  competitors: [
    { name: "Tint A Car Oxenford", domain: "tintacar.com.au", suburb: "Oxenford", quote: "Protect your home with security window film", ads: 2, started: "2025-03-04" },
    { name: "Robina Mobile Tint", domain: "robinamobiletint.com.au", suburb: null, quote: "We come to you, anywhere on the Gold Coast", ads: 1, started: "2026-11-01" },
  ],
  pages: 4,
  library_urls: ["https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=AU&q=window%20tinting%20gold%20coast&search_type=keyword_unordered&media_type=all"],
};

const input: ReviewInput = {
  business: "Black Diamond Tinting",
  firstName: null,
  domain: "blackdiamondtinting.com.au",
  leadWord: "quotes",
  meta: { live: true, ads: 3, started: "2026-03-23", pageText: LIBRARY },
  google: { live: false, ads: 0, lastShown: null },
  measurement: {
    url: "https://blackdiamondtinting.com.au/",
    faults: ["no_meta_pixel", "old_analytics", "slow_mobile", "layout_shift", "phone_not_tappable"],
    pageviews: 0,
    brokenPages: [],
    tracking: { siteKind: "other", gtm: [], gtmRead: true, gtmEmpty: false, metaSeen: false, googleSeen: true, consent: false },
  },
  followUpSent: true,
  competitors: COMPETITORS,
  today: "2026-11-27",
};

test("live ad lines: active ads on their site, bold letters made plain, no repeats", () => {
  assert.equal(longDate("2026-03-23"), "23 March 2026");
  assert.deepEqual(liveAdLines(LIBRARY, "blackdiamondtinting.com.au"), [
    { text: "Black Diamond Tinting Co.", started: "2026-03-23" },
    { text: "Summer is here", started: "2026-11-08" },
  ]);
});

test("how long an ad has run, and offers whose date has passed", () => {
  assert.equal(runWords("2026-03-23", "2026-11-27"), "about eight months");
  assert.equal(runWords("2025-03-04", "2026-11-27"), "over a year");
  assert.equal(runWords("2023-10-01", "2026-11-27"), "over three years");
  assert.equal(pastOffer("Summer sale ends 30 June, book now", "2026-06-01", "2026-11-27"), "30 June");
  assert.equal(pastOffer("Offer ends Friday 15th March", "2025-12-01", "2026-11-27"), "15 March");
  assert.equal(pastOffer("Book before December 20th", "2026-11-01", "2026-11-27"), null);
  assert.equal(pastOffer("Black Friday, until November 30", "2026-11-20", "2026-11-27"), null);
  assert.equal(pastOffer("Lifetime warranty on every job", "2025-01-01", "2026-11-27"), null);
});

test("the review draft for Black Diamond Tinting: three changes, competitors named, the record", () => {
  const r = reviewDraft(input);
  assert.equal(r.subject, "Your free ads review, Black Diamond Tinting");
  const b = r.body;
  assert.match(b, /^Hi there,\n\nThanks for getting back to us\. Here's the review we promised\. It's yours to keep either way\.\n\nThe three things we'd change first\n1\. /);
  // 1. The ads' own words, with Kyle's line to write.
  assert.match(b, /1\. Give your ads something to say\. In Meta's Ad Library, the words in two of your three Facebook ads are just "Black Diamond Tinting Co"\. \[Kyle: the line you'd lead with instead, and why\.\]/);
  // 2. The tracking gap, pointing to the follow-up's steps rather than repeating them.
  assert.match(b, /2\. Let Facebook see who asks for a quote\. The site has no Meta Pixel, so Facebook can only aim your ads at people likely to click, not people likely to ask for a quote\. The steps are in our last email\./);
  assert.doesNotMatch(b, /Events Manager/);
  // 3. The next thing on the site that isn't speed.
  assert.match(b, /3\. Swap the old Google Analytics for GA4\./);
  assert.doesNotMatch(b, /\n4\. /);
  // Competitors, named, with their own words and how long they've run.
  assert.match(b, /\n\nWhat other window tinting businesses near you are running\nAt least two other window tinting businesses around the Gold Coast have Facebook ads running:\n/);
  assert.match(b, /• Tint A Car Oxenford, in Oxenford, leads with "Protect your home with security window film", across two ads, the earliest since 4 March 2025\./);
  assert.match(b, /• Robina Mobile Tint leads with "We come to you, anywhere on the Gold Coast", in an ad running since 1 November 2026\./);
  assert.match(b, /\[Kyle: where Black Diamond Tinting stands apart from these, in a line or two\.\]/);
  // The record, at the bottom, with what didn't make the three.
  assert.match(b, /\n\nFor the record\n• Facebook: three ads running to your website, the earliest since 23 March 2026\.\n• Google: none showing in Google's Ads Transparency Centre when we checked\.\n• Tracking: no Meta Pixel, and only Google's old Universal Analytics\.\n• Your phone number shows on the page but can't be tapped to ring\.\n\nNone of this needs us\./);
  assert.match(b, /the fixed monthly fee for it, in writing\. It's set by the job, not a percentage of what you spend on ads\./);
  assert.match(b, /Kyle Hartwell\nHartwell Digital, ABN 44 286 503 049/);
  // Never site speed (Kyle: "too generic"), words for small numbers.
  assert.doesNotMatch(b, /second|speed|slow|jumps|lighter/i);
  assert.doesNotMatch(b, /\b(1|2|3|4|5|6|7|8|9|10) (ads|things|other)\b/);
  // House and brand rules: no dashes in sentences, no exclamation marks, no price.
  assert.doesNotMatch(b, /[—–!$]|\s-\s|--/);
});

test("before the follow-up has gone, the tracking change carries its own steps", () => {
  const b = reviewDraft({ ...input, followUpSent: false }).body;
  assert.match(b, /2\. Let Facebook see who asks for a quote\..*Here's how\. In Meta Events Manager, create a Pixel/);
  assert.doesNotMatch(b, /in our last email/);
});

test("an ad running six months or more, and an offer that has finished", () => {
  const text = `Active
Library ID: 5555555555555555
Started running on Mar 4, 2025
Black Diamond Tinting Co.
Sponsored
Lifetime warranty window tinting on the Gold Coast
BLACKDIAMONDTINTING.COM.AU
Active
Library ID: 6666666666666666
Started running on Jun 1, 2026
Black Diamond Tinting Co.
Sponsored
Winter special: 20% off home tinting, ends 31 August
BLACKDIAMONDTINTING.COM.AU`;
  const b = reviewDraft({ ...input, meta: { live: true, ads: 2, started: "2025-03-04", pageText: text } }).body;
  assert.match(b, /1\. Take down the offer that's finished\. Your Facebook ad "Winter special: 20% off home tinting, ends 31 August" is still running, but its date, 31 August, has passed\. \[Kyle: what you'd run in its place\.\]/);
  assert.match(b, /2\. Let Facebook see who asks for a quote\./);
  assert.match(b, /3\. Freshen up your longest running ad\. "Lifetime warranty window tinting on the Gold Coast" has been running since 4 March 2025, over a year, and people who keep seeing the same ad tend to stop noticing it\. \[Kyle: what the fresh one would say\.\]/);
  // The record doesn't explain a third time what a change already says.
  assert.match(b, /• Tracking: no Meta Pixel, and the only analytics is Google's old Universal Analytics, which stopped recording in July 2023\./);
  assert.doesNotMatch(b, /\n• The only analytics on the site/);
});

test("a competitor search that found nobody, and one that hasn't run", () => {
  const none = reviewDraft({ ...input, competitors: { ...COMPETITORS, competitors: [] } }).body;
  assert.match(none, /What other window tinting businesses near you are running\n\[Kyle: Pulse's search found no other window tinting businesses with Facebook ads around the Gold Coast\. Have a quick look in Meta's Ad Library yourself, or delete this part\.\]/);
  const notYet = reviewDraft({ ...input, competitors: null }).body;
  assert.match(notYet, /Who else near you is advertising\n\[Kyle: the competitor search hasn't run yet\. The PC run does it the morning after a yes/);
});

test("a review with nothing measured still drafts, and says what's missing", () => {
  const r = reviewDraft({ ...input, measurement: null, meta: null, google: null, competitors: null });
  assert.match(r.body, /The two things we'd change first\n1\. \[Kyle: the change to the ads themselves you'd make first, and why\.\]\n2\. \[Kyle: Pulse has no tracking reading/);
  assert.match(r.body, /no ad-library check is on record/);
});
