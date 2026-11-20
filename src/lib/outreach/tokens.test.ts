import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedAreas, melbourneWeekday, nameKey, pageNamesFor, regionsFor, secondsWords, timesWords, tokensIn } from "./tokens.ts";
import { addressOnPage, onOwnSite } from "./contact.ts";
import { greeting } from "./render.ts";

test("load times are rounded down and worded, never up", () => {
  assert.equal(secondsWords(6400), "a little over six seconds");
  assert.equal(secondsWords(6050), "six seconds");
  assert.equal(secondsWords(6999), "a little over six seconds");
  assert.equal(secondsWords(4000), "four seconds");
  assert.equal(secondsWords(1300), "a little over one second");
  assert.equal(secondsWords(23_500), "a little over 23 seconds");
  assert.equal(timesWords(2), "twice");
  assert.equal(timesWords(3), "three times");
});

test("the weekday is Melbourne's, across daylight saving", () => {
  assert.equal(melbourneWeekday("2026-11-17T22:00:00Z"), "Wednesday"); // 9am AEDT
  assert.equal(melbourneWeekday("2026-11-17T12:59:00Z"), "Tuesday"); // 11:59pm AEDT
  assert.equal(melbourneWeekday("2026-06-16T14:00:00Z"), "Wednesday"); // midnight AEST
});

test("page names come from the address or the menu label", () => {
  assert.deepEqual([...pageNamesFor("https://catten.com.au/canopies/")], ["canopy"]);
  assert.ok(pageNamesFor("https://catten.com.au/").has("home"));
  assert.ok(pageNamesFor("https://catten.com.au/ute-trays.html").has("ute tray"));
  assert.ok(pageNamesFor("https://x.com.au/a", ["Dual Batteries"]).has("dual battery"));
  assert.equal(nameKey("Canopies"), nameKey("canopy"));
});

test("an area is the business's suburb or its postcode's region", () => {
  assert.deepEqual(regionsFor("4551"), ["Sunshine Coast"]);
  assert.deepEqual(regionsFor("3061"), ["Melbourne"]);
  assert.ok(regionsFor("3934").includes("Mornington Peninsula"));
  const a = allowedAreas({ suburb: "Caloundra", postcode: "4551" });
  assert.ok(a.has("caloundra") && a.has("sunshine coast"));
  assert.ok(!a.has("melbourne") && !a.has("bayswater"));
});

test("tokens are found, known or not", () => {
  assert.deepEqual(tokensIn("On [[day]] your [[ page ]] page and [[nope]]"), ["day", "page", "nope"]);
});

test("the address must be on the page, with no no-marketing note near it", () => {
  assert.deepEqual(addressOnPage("<p>Email sam@catten.com.au for quotes</p>", "sam@catten.com.au"), { found: true, noMarketingNearby: false });
  assert.equal(addressOnPage('<a href="mailto:Sam@Catten.com.au">Email us</a>', "sam@catten.com.au").found, true);
  assert.equal(addressOnPage("<p>sam&#64;catten.com.au</p>", "sam@catten.com.au").found, true);
  assert.equal(addressOnPage("<p>sam [at] catten.com.au</p>", "sam@catten.com.au").found, false);
  assert.equal(addressOnPage("<p>info@catten.com.au</p>", "sam@catten.com.au").found, false);
  assert.deepEqual(
    addressOnPage("<p>Accounts: sam@catten.com.au. No marketing or unsolicited emails please.</p>", "sam@catten.com.au"),
    { found: true, noMarketingNearby: true },
  );
  assert.equal(onOwnSite("https://www.catten.com.au/contact", "catten.com.au"), true);
  assert.equal(onOwnSite("https://shop.catten.com.au/contact", "catten.com.au"), true);
  assert.equal(onOwnSite("https://yellowpages.com.au/catten", "catten.com.au"), false);
});

test("a greeting only uses a real first name", () => {
  assert.equal(greeting("Sam"), "Sam");
  assert.equal(greeting("Mary-Jane"), "Mary-Jane");
  assert.equal(greeting(null), "there");
  assert.equal(greeting("Sales Team"), "there");
});
