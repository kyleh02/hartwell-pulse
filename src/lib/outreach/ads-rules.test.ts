import { test } from "node:test";
import assert from "node:assert/strict";
import {
  googleAdUrlProblem,
  libraryDate,
  libraryUrlProblem,
  libraryUrls,
  liveAds,
  platformWords,
  readAdsCheck,
  readGoogleText,
  readMetaText,
  type AdsEvidence,
} from "./ads-rules.ts";

// Real page text, read in Chrome on 22 November 2026 (zero-width characters kept).
const META_SSC = `Meta Ad Library
Ad Library
Australia
​
All ads
Search by keyword or advertiser
~2 results
These results include ads that match your keyword search.
Filters (1)
​
Active
Library ID: 564901046449960
Started running on Dec 22, 2024
Platforms
​
2 ads use this creative and text
Menu
See summary details
Sunshine Coast 4WD Centre
Sponsored
Sunshine Coast 4WD Centre  for all your 4WD mechanical - passenger car servicing, parts & fabrication
​
Active
Library ID: 1829050127813086
Started running on Mar 1, 2026
Platforms
​
Menu
See ad details
Sunshine Coast 4WD Centre
Sponsored
Sunshine Coast 4WD Centre  for all your 4WD mechanical - passenger car servicing, parts & fabrication
SSC4WD.COM.AU
Sunshine Coast 4WD Centre
Expert`;

const GOOGLE_SEARCH_SSC = `Ads Transparency Centre
FAQs
Ads in Australia
arrow_drop_down
ssc4wd.com.au
This domain includes results for multiple advertiser accounts with ads pointing to this domain. You can filter by individual advertiser below.
3 ads
calendar_today
Any time
Blake Sutherland
Verified`;

const GOOGLE_AD_SSC = `Ads Transparency Centre
Home
Blake Sutherland
Ad details
Blake Sutherland
The information about this ad may vary by location
Shown in Australia
close
Last shown: 20 Nov 2026
Format: Text
1 of 2 variations`;

test("the library searches Pulse builds pass its own checks", () => {
  const u = libraryUrls("ssc4wd.com.au");
  assert.equal(libraryUrlProblem("meta", u.meta, "ssc4wd.com.au"), null);
  assert.equal(libraryUrlProblem("google", u.google, "ssc4wd.com.au"), null);
  // Another domain, the wrong country, inactive ads included, or another site.
  assert.match(libraryUrlProblem("meta", u.meta, "other.com.au")!, /their domain/);
  assert.match(libraryUrlProblem("meta", u.meta.replace("country=AU", "country=US"), "ssc4wd.com.au")!, /Australia/);
  assert.match(libraryUrlProblem("meta", u.meta.replace("active_status=active", "active_status=all"), "ssc4wd.com.au")!, /active ads only/);
  assert.match(libraryUrlProblem("google", "https://adstransparency.google.com/?region=US&domain=ssc4wd.com.au", "ssc4wd.com.au")!, /Australia/);
  assert.match(libraryUrlProblem("google", "https://example.com/?region=AU&domain=ssc4wd.com.au", "ssc4wd.com.au")!, /Transparency/);
  assert.equal(googleAdUrlProblem("https://adstransparency.google.com/advertiser/AR00082807278704525313/creative/CR04928999310357430273?region=AU"), null);
  assert.match(googleAdUrlProblem("https://adstransparency.google.com/advertiser/AR00082807278704525313?region=AU")!, /one ad's page/);
});

test("library dates in both formats", () => {
  assert.equal(libraryDate("Dec 22, 2024"), "2024-12-22");
  assert.equal(libraryDate("20 Nov 2026"), "2026-11-20");
  assert.equal(libraryDate("Sept 3, 2026"), "2026-09-03");
  assert.equal(libraryDate("31 Feb 2026"), null);
  assert.equal(libraryDate("yesterday"), null);
});

test("Pulse's own reading of a real Ad Library page", () => {
  const r = readMetaText(META_SSC, "ssc4wd.com.au");
  assert.equal(r.active, 2);
  // Only the second card shows the domain; the first is a Page ad with no link.
  assert.equal(r.activeOnDomain, 1);
  assert.deepEqual(r.libraryIds, ["1829050127813086"]);
  assert.equal(r.earliestStart, "2026-03-01");
  // Inactive cards never count.
  const inactive = META_SSC.replace(/Active\nLibrary ID: 1829050127813086/, "Inactive\nLibrary ID: 1829050127813086");
  assert.equal(readMetaText(inactive, "ssc4wd.com.au").activeOnDomain, 0);
});

test("Pulse's own reading of a real Transparency Centre search and ad", () => {
  const g = readGoogleText(GOOGLE_SEARCH_SSC, GOOGLE_AD_SSC, "ssc4wd.com.au");
  assert.deepEqual(g, { ads: 3, domainShown: true, lastShown: "2026-11-20", shownInAustralia: true });
});

test("a check becomes evidence only on Pulse's reading", () => {
  const now = new Date("2026-11-22T11:00:00Z");
  const u = libraryUrls("ssc4wd.com.au");
  const meta = readAdsCheck({ platform: "meta", library_url: u.meta, page_text: META_SSC }, "ssc4wd.com.au", now, "2026-11-22");
  assert.ok("evidence" in meta);
  assert.equal(meta.evidence.live, true);
  assert.equal(meta.evidence.started, "2026-03-01");

  const google = readAdsCheck(
    { platform: "google", library_url: u.google, page_text: GOOGLE_SEARCH_SSC, ad_url: "https://adstransparency.google.com/advertiser/AR00082807278704525313/creative/CR04928999310357430273?region=AU", ad_text: GOOGLE_AD_SSC },
    "ssc4wd.com.au",
    now,
    "2026-11-22",
  );
  assert.ok("evidence" in google);
  assert.equal(google.evidence.live, true);
  assert.equal(google.evidence.last_shown, "2026-11-20");

  // Last shown more than a fortnight before the check: on record, not live.
  const stale = readAdsCheck(
    { platform: "google", library_url: u.google, page_text: GOOGLE_SEARCH_SSC, ad_url: "https://adstransparency.google.com/advertiser/AR1/creative/CR2?region=AU", ad_text: GOOGLE_AD_SSC.replace("20 Nov 2026", "26 Mar 2026") },
    "ssc4wd.com.au",
    now,
    "2026-11-22",
  );
  assert.ok("evidence" in stale && stale.evidence.live === false);

  // Ads listed, but no ad page: refused, so Claude opens one.
  const noAd = readAdsCheck({ platform: "google", library_url: u.google, page_text: GOOGLE_SEARCH_SSC }, "ssc4wd.com.au", now, "2026-11-22");
  assert.ok("problems" in noAd && /ad_url/.test(noAd.problems.join(" ")));

  // A page for some other domain can't back this one.
  const wrong = readAdsCheck({ platform: "meta", library_url: libraryUrls("other.com.au").meta, page_text: META_SSC }, "ssc4wd.com.au", now, "2026-11-22");
  assert.ok("problems" in wrong);

  // An empty Google search is a clean "no ads", not an error.
  const none = readAdsCheck(
    { platform: "google", library_url: libraryUrls("theuteshop.com.au").google, page_text: "Ads Transparency Centre\nAds in Australia\ntheuteshop.com.au\n0 ads\nAny time" },
    "theuteshop.com.au",
    now,
    "2026-11-22",
  );
  assert.ok("evidence" in none && none.evidence.live === false && none.evidence.ads === 0);
});

test("only fresh live checks count, newest per platform", () => {
  const now = new Date("2026-11-23T11:00:00Z");
  const e = (platform: "meta" | "google", live: boolean, at: string): AdsEvidence => ({
    platform, live, checked_at: at, library_url: "", ad_url: null, ads: live ? 1 : 0, started: null, last_shown: null, note: "",
  });
  assert.deepEqual(liveAds([e("google", true, "2026-11-22T11:00:00Z")], now, 36).platforms, ["google"]);
  assert.deepEqual(liveAds([e("google", true, "2026-11-21T11:00:00Z")], now, 36).platforms, []);
  // A newer check that found nothing wins over an older live one.
  assert.deepEqual(liveAds([e("meta", true, "2026-11-22T10:00:00Z"), e("meta", false, "2026-11-22T12:00:00Z")], now, 36).platforms, []);
  assert.deepEqual(liveAds([e("meta", true, "2026-11-22T10:00:00Z"), e("google", true, "2026-11-22T10:05:00Z")], now, 36).platforms, ["google", "meta"]);
  assert.equal(platformWords(["google", "meta"]), "Google and Facebook");
  assert.equal(platformWords(["meta"]), "Facebook");
  assert.equal(platformWords([]), null);
});
