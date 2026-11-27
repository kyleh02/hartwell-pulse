/**
 * The free ads review Pulse drafts for Kyle (27 November 2026): facts from
 * the records, Kyle's own judgement left in brackets, and the brand rules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { liveAdLines, longDate, reviewDraft, type ReviewInput } from "./review-draft.ts";

const LIBRARY = `Active
Library ID: 1111111111111111
Started running on Mar 23, 2026
Black Diamond Tinting Co.
Sponsored
Lifetime warranty window tinting on the Gold Coast
BLACKDIAMONDTINTING.COM.AU
Contact us
Active
Library ID: 2222222222222222
Started running on Nov 8, 2026
Black Diamond Tinting Co
Sponsored
𝗦𝘂𝗺𝗺𝗲𝗿 𝗶𝘀 𝗵𝗲𝗿𝗲
BLACKDIAMONDTINTING.COM.AU
Inactive
Library ID: 3333333333333333
Started running on Jan 2, 2025
Black Diamond Tinting Co
Sponsored
An old ad
BLACKDIAMONDTINTING.COM.AU`;

const input: ReviewInput = {
  business: "Black Diamond Tinting",
  firstName: null,
  domain: "blackdiamondtinting.com.au",
  leadWord: "quotes",
  meta: { live: true, ads: 3, started: "2026-03-23", pageText: LIBRARY },
  google: { live: false, ads: 0, lastShown: null },
  measurement: {
    url: "https://blackdiamondtinting.com.au/",
    faults: ["no_meta_pixel", "old_analytics", "slow_mobile", "phone_not_tappable"],
    lcpMs: 7400,
    fcpMs: 3100,
    pageviews: 0,
    brokenPages: [],
    tracking: { siteKind: "other", gtm: [], gtmRead: true, gtmEmpty: false, metaSeen: false, googleSeen: true, consent: false },
  },
  today: "2026-11-27",
};

test("live ad lines: active ads on their site, bold letters made plain", () => {
  assert.equal(longDate("2026-03-23"), "23 March 2026");
  assert.deepEqual(liveAdLines(LIBRARY, "blackdiamondtinting.com.au"), [
    { text: "Lifetime warranty window tinting on the Gold Coast", started: "2026-03-23" },
    { text: "Summer is here", started: "2026-11-08" },
  ]);
});

test("the review draft for Black Diamond Tinting", () => {
  const r = reviewDraft(input);
  assert.equal(r.subject, "Your free ads review, Black Diamond Tinting");
  const b = r.body;
  assert.match(b, /^Hi there,\n\nThanks for getting back to us\./);
  assert.match(b, /• Facebook: 3 ads are running to your website, the earliest since 23 March 2026\./);
  assert.match(b, /"Summer is here" \(running since 8 November 2026\)/);
  assert.match(b, /• Google: Google's Ads Transparency Centre showed no recent ads/);
  assert.match(b, /• Meta Pixel: not on the site, so Facebook can't tell which clicks turned into quote requests\./);
  assert.match(b, /• Google tag: only the old Universal Analytics, which stopped recording in July 2023\./);
  assert.match(b, /took a little over seven seconds to show its main content, which Google counts as slow\./);
  assert.match(b, /can't be tapped to ring/);
  assert.match(b, /1\. Measure what the ads bring in\. In Meta Events Manager, create a Pixel/);
  assert.match(b, /Make the phone number a tap-to-call link/);
  assert.match(b, /\[Kyle: the change to the ads themselves you'd make first\.\]/);
  assert.match(b, /the fixed monthly fee for it, in writing\. It's set by the job, not a percentage of what you spend on ads\./);
  assert.match(b, /Kyle Hartwell\nHartwell Digital, ABN 44 286 503 049/);
  // House and brand rules: no dashes in sentences, no exclamation marks, no price.
  assert.doesNotMatch(b, /[—–!$]|\s-\s|--/);
});

test("a review with nothing measured still drafts, and says what's missing", () => {
  const r = reviewDraft({ ...input, measurement: null, meta: null, google: null });
  assert.match(r.body, /no ad-library check is on record/);
  assert.match(r.body, /Pulse has no tracking reading/);
  assert.match(r.body, /1\. \[Kyle: the change to the ads themselves/);
});
