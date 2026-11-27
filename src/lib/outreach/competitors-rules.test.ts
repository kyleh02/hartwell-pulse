/**
 * The free review's competitor search (27 November 2026): Pulse names a
 * local advertiser only from the Ad Library pages themselves, and only with
 * the opening words of one of its own live ads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adCards, cardShows, openingLine } from "./ad-cards.ts";
import {
  areaProblem,
  cleanName,
  competitorSearchUrl,
  leadQuoteProblem,
  readCompetitors,
  searchUrlProblem,
  serviceProblem,
  suburbProblem,
} from "./competitors-rules.ts";

const PAGE = `Ad Library
Active
Library ID: 4444444444444444
Started running on Mar 4, 2025
Platforms
This ad has multiple versions
Tint A Car Oxenford Pty Ltd
Sponsored
Protect your home with security window film this summer.
TINTACAR.COM.AU
Learn more
Active
Library ID: 5555555555555555
Started running on Jun 10, 2025
Tint A Car Oxenford
Sponsored
Cooler rooms in one day
TINTACAR.COM.AU
Active
Library ID: 6666666666666666
Started running on Nov 1, 2026
Robina Mobile Tint
Sponsored
🚐 We come to you, anywhere on the Gold Coast
ROBINAMOBILETINT.COM.AU
Active
Library ID: 7777777777777777
Started running on Mar 23, 2026
Black Diamond Tinting Co.
Sponsored
Black Diamond Tinting Co.
BLACKDIAMONDTINTING.COM.AU
Inactive
Library ID: 8888888888888888
Started running on Jan 2, 2024
Old Tint
Sponsored
Gone but not forgotten here
OLDTINT.COM.AU
Active
Library ID: 9999999999999999
Started running on Feb 2, 2026
Black Tint Brisbane
Sponsored
Brisbane's tint people since forever
BLACKTINT.COM.AU`;

// The second page repeats one card: it counts once.
const PAGE2 = `Active
Library ID: 5555555555555555
Started running on Jun 10, 2025
Tint A Car Oxenford
Sponsored
Cooler rooms in one day
TINTACAR.COM.AU`;

const OWN = { domain: "blackdiamondtinting.com.au", name: "Black Diamond Tinting Co" };

test("ad cards: page name, opening words, start date, and whole domains only", () => {
  const cards = adCards(PAGE);
  assert.equal(cards.length, 6);
  assert.equal(cards[0].name, "Tint A Car Oxenford Pty Ltd");
  assert.equal(cards[0].started, "2025-03-04");
  assert.equal(openingLine(cards[0]), "Protect your home with security window film this summer.");
  assert.equal(cards[4].active, false);
  assert.ok(cardShows(cards[0], "tintacar.com.au"));
  assert.ok(!cardShows(cards[5], "tint.com.au"), "tint.com.au isn't blacktint.com.au");
  assert.ok(!cardShows(cards[0], "tintacar.com"), "tintacar.com isn't tintacar.com.au");
  assert.equal(cleanName("Tint A Car Oxenford Pty Ltd"), "Tint A Car Oxenford");
  assert.equal(cleanName("Robina Mobile Tint Pty. Ltd."), "Robina Mobile Tint");
});

test("named from the pages: the library's name, its ad count and earliest start, an exact opening quote", () => {
  const r = readCompetitors(
    [PAGE, PAGE2],
    [
      { domain: "tintacar.com.au", suburb: "Oxenford", quote: "Protect your home with security window film" },
      { domain: "https://www.robinamobiletint.com.au/", quote: "We come to you, anywhere on the Gold Coast" },
    ],
    OWN,
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.competitors, [
    { name: "Tint A Car Oxenford", domain: "tintacar.com.au", suburb: "Oxenford", quote: "Protect your home with security window film", ads: 2, started: "2025-03-04" },
    { name: "Robina Mobile Tint", domain: "robinamobiletint.com.au", suburb: null, quote: "We come to you, anywhere on the Gold Coast", ads: 1, started: "2026-11-01" },
  ]);
});

test("refused: their own site, words from the middle of an ad, a domain no live ad shows", () => {
  const r = readCompetitors(
    [PAGE],
    [
      { domain: "blackdiamondtinting.com.au", quote: "Black Diamond Tinting Co" },
      { domain: "tintacar.com.au", quote: "security window film this summer" },
      { domain: "tint.com.au", quote: "Brisbane's tint people since forever" },
      { domain: "oldtint.com.au", quote: "Gone but not forgotten here" },
      { domain: "robinamobiletint.com.au", quote: "We come to you for $99" },
    ],
    OWN,
  );
  assert.ok(!r.ok);
  const all = r.problems.join(" | ");
  assert.match(all, /blackdiamondtinting\.com\.au is the business's own site/);
  assert.match(all, /tintacar\.com\.au: "security window film this summer" doesn't open any line/);
  assert.match(all, /tint\.com\.au: no active ad on the pages you passed shows TINT\.COM\.AU/);
  assert.match(all, /oldtint\.com\.au: no active ad/);
  assert.match(all, /robinamobiletint\.com\.au: quote must be plain words/);
  const six = readCompetitors([PAGE], Array.from({ length: 6 }, () => ({ domain: "tintacar.com.au", quote: "Cooler rooms in one day" })), OWN);
  assert.ok(!six.ok && six.problems.some((p) => /Five competitors at most/.test(p)));
});

test("the words the review uses, checked", () => {
  assert.equal(serviceProblem("window tinting"), null);
  assert.equal(serviceProblem("ute canopy"), null);
  assert.ok(serviceProblem("Window Tinting"));
  assert.ok(serviceProblem("tinting!"));
  assert.equal(areaProblem("the Gold Coast"), null);
  assert.equal(areaProblem("Brisbane's north side"), null);
  assert.ok(areaProblem("the Gold Coast, QLD 4217"));
  assert.equal(suburbProblem("Oxenford"), null);
  assert.ok(suburbProblem("Unit 4, 12 Smith St"));
  assert.equal(leadQuoteProblem("Cooler rooms in one day"), null);
  assert.ok(leadQuoteProblem("Cool rooms"));
  assert.ok(leadQuoteProblem("Half price tint this week only!"));
  assert.equal(
    competitorSearchUrl("Window  Tinting Gold Coast"),
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=AU&q=window%20tinting%20gold%20coast&search_type=keyword_unordered&media_type=all",
  );
  assert.equal(searchUrlProblem(competitorSearchUrl("window tinting gold coast")), null);
  assert.ok(searchUrlProblem("https://www.facebook.com/ads/library/?active_status=active"));
  assert.ok(searchUrlProblem("https://example.com/ads/library/?q=tint"));
});
