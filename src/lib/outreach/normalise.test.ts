/**
 * These outputs are pinned on purpose. Fingerprints store a hash of these
 * keys, so if one of these tests needs changing, old fingerprints would stop
 * matching. Add a new rule beside the old ones instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  businessKeys,
  emailDomain,
  isValidAbn,
  namesOf,
  normaliseAbn,
  normaliseDomain,
  normaliseEmail,
  normaliseName,
  normalisePhone,
} from "./normalise.ts";

test("a website, a URL and an email all give the same domain", () => {
  for (const s of [
    "catten.com.au",
    "www.catten.com.au",
    "WWW.Catten.com.au.",
    "https://www.catten.com.au/contact?x=1",
    "http://catten.com.au:8080/",
    " catten.com.au/ ",
    "sales@catten.com.au",
  ]) {
    assert.equal(normaliseDomain(s), "catten.com.au", s);
  }
  // A subdomain is its own key: shared platforms give every business one.
  assert.equal(normaliseDomain("shop.catten.com.au"), "shop.catten.com.au");
});

test("things that aren't a business's own domain give no domain key", () => {
  for (const s of ["", null, undefined, "localhost", "192.168.0.1", "not a domain", "facebook.com/catten", "https://www.instagram.com/x", "linktr.ee/x"]) {
    assert.equal(normaliseDomain(s), null, String(s));
  }
});

test("webmail never gives a domain key, a business address does", () => {
  assert.equal(emailDomain("sam@gmail.com"), null);
  assert.equal(emailDomain("Sam@BigPond.com"), null);
  assert.equal(emailDomain("jo@optusnet.com.au"), null);
  assert.equal(emailDomain("Mike@DVREngineering.com.au"), "dvrengineering.com.au");
});

test("email addresses compare the way mail is delivered", () => {
  assert.equal(normaliseEmail("  Sales@Catten.com.au "), "sales@catten.com.au");
  assert.equal(normaliseEmail("Ian <ian+quotes@catten.com.au>"), "ian@catten.com.au");
  assert.equal(normaliseEmail("mailto:ian@catten.com.au"), "ian@catten.com.au");
  assert.equal(normaliseEmail("S.a.m+x@googlemail.com"), "sam@gmail.com");
  // Dots matter everywhere except Gmail.
  assert.equal(normaliseEmail("s.am@catten.com.au"), "s.am@catten.com.au");
  for (const bad of ["", "nope", "a@b", "@catten.com.au", "a@@b.com"]) assert.equal(normaliseEmail(bad), null, bad);
});

test("ABNs: the ATO check digit, spaces ignored", () => {
  assert.equal(isValidAbn("44286503049"), true);
  assert.equal(isValidAbn("51824753556"), true);
  assert.equal(isValidAbn("44286503048"), false);
  assert.equal(normaliseAbn("44 286 503 049"), "44286503049");
  assert.equal(normaliseAbn("ABN 51 824 753 556"), "51824753556");
  assert.equal(normaliseAbn("12 345 678 901"), null);
  assert.equal(normaliseAbn("123"), null);
});

test("business names ignore case, punctuation, Pty Ltd and a leading The", () => {
  const k = "cattenindustries";
  for (const s of ["Catten Industries", "CATTEN INDUSTRIES PTY LTD", "Catten Industries Pty. Ltd.", "The Catten Industries", "catten-industries limited"]) {
    assert.equal(normaliseName(s), k, s);
  }
  assert.equal(normaliseName("Smith & Sons"), normaliseName("Smith and Sons"));
  assert.equal(normaliseName("Café Rouge"), "caferouge");
  assert.equal(normaliseName("O'Brien's Ute Trays"), "obriensutetrays");
  // Exact match only: a longer name is a different business.
  assert.notEqual(normaliseName("Smith Engineering"), normaliseName("Smith Engineering Services"));
  assert.equal(normaliseName("Pty Ltd"), null);
  assert.equal(normaliseName("A"), null);
});

test("a trading name gives both names", () => {
  assert.deepEqual(namesOf("Smith Holdings Pty Ltd t/a Ute Trays Plus"), ["smithholdings", "utetraysplus"]);
  assert.deepEqual(namesOf("Smith Holdings trading as Ute Trays Plus"), ["smithholdings", "utetraysplus"]);
});

test("phone numbers: one key however they're written", () => {
  for (const s of ["(07) 5555 1234", "07 5555 1234", "+61 7 5555 1234", "+61 (0)7 5555 1234", "0011 61 7 5555 1234", "07-5555-1234"]) {
    assert.equal(normalisePhone(s), "0755551234", s);
  }
  assert.equal(normalisePhone("0412 345 678"), "0412345678");
  assert.equal(normalisePhone("+61412345678"), "0412345678");
  assert.equal(normalisePhone("1300 123 456"), "1300123456");
  assert.equal(normalisePhone("13 12 34"), "131234");
  // No area code: the same digits could be another state's number.
  assert.equal(normalisePhone("5555 1234"), null);
  assert.equal(normalisePhone("call us"), null);
});

test("businessKeys gathers every key once", () => {
  const keys = businessKeys({
    website: "https://www.catten.com.au/",
    email: ["sales@catten.com.au", "ian@gmail.com"],
    name: "Catten Industries Pty Ltd",
    abn: "51 824 753 556",
    phone: "(03) 9555 1234",
  });
  assert.deepEqual(
    keys.map((k) => `${k.kind}:${k.value}`).sort(),
    [
      "abn:51824753556",
      "domain:catten.com.au",
      "email:ian@gmail.com",
      "email:sales@catten.com.au",
      "name:cattenindustries",
      "phone:0395551234",
    ],
  );
  assert.deepEqual(businessKeys({}), []);
});
