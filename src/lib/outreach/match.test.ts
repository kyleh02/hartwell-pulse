import { test } from "node:test";
import assert from "node:assert/strict";
import { businessKeys } from "./normalise.ts";
import { matchBusiness, publicVerdict, type KnownRecord } from "./match.ts";

const catten = businessKeys({
  website: "https://catten.com.au",
  email: "ian@catten.com.au",
  name: "Catten Industries Pty Ltd",
  abn: "51 824 753 556",
  phone: "(03) 9555 1234",
});

const record = (source: KnownRecord["source"], input: Parameters<typeof businessKeys>[0], label = "x"): KnownRecord => ({
  source,
  label,
  keys: businessKeys(input),
});

test("a business nobody knows is allowed", () => {
  const v = matchBusiness(catten, [record("lead", { email: "jo@otherbiz.com.au", name: "Other Biz" })], []);
  assert.equal(v.allowed, true);
  assert.deepEqual(v.blocks, []);
});

test("a fingerprint blocks: contacted before, opted out, or imported", () => {
  for (const reason of ["contacted", "opted_out", "imported", "do_not_contact"] as const) {
    const v = matchBusiness(catten, [], [{ kind: "domain", reason }]);
    assert.equal(v.allowed, false, reason);
    assert.equal(v.blocks[0].source, "fingerprint");
  }
});

test("a lead in the pipeline blocks, by any key", () => {
  for (const input of [
    { website: "www.catten.com.au/about" },
    { email: "Sales@Catten.com.au" },
    { name: "CATTEN INDUSTRIES" },
    { phone: "+61 3 9555 1234" },
  ]) {
    const v = matchBusiness(catten, [record("lead", input, "Lead: Catten")], []);
    assert.equal(v.allowed, false, JSON.stringify(input));
    assert.equal(v.blocks[0].source, "lead");
  }
});

test("a client blocks, by ABN or a client contact's address", () => {
  assert.equal(matchBusiness(catten, [record("client", { abn: "51824753556", name: "Different Trading Name" })], []).allowed, false);
  assert.equal(matchBusiness(catten, [record("client", { email: "accounts@catten.com.au" })], []).allowed, false);
});

test("a no from one address blocks the whole business", () => {
  // Ian's colleague asked not to be emailed. Ian's address is different,
  // but it's the same business: the domain matches.
  const dnc = record("do_not_contact", { email: "latinka@catten.com.au" }, "Do not contact: Catten");
  const v = matchBusiness(businessKeys({ email: "ian@catten.com.au", website: "catten.com.au" }), [dnc], []);
  assert.equal(v.allowed, false);
  assert.deepEqual(v.blocks.map((b) => [b.source, b.kind]), [["do_not_contact", "domain"]]);

  // A no by business name alone blocks a new address at that business.
  const byName = record("do_not_contact", { name: "Catten Industries" });
  assert.equal(matchBusiness(businessKeys({ name: "Catten Industries Pty Ltd", email: "new@catten.net" }), [byName], []).allowed, false);
});

test("a no from a Gmail address blocks that address, not everyone on Gmail", () => {
  const dnc = record("do_not_contact", { email: "sam@gmail.com" });
  assert.equal(matchBusiness(businessKeys({ email: "s.a.m+work@gmail.com" }), [dnc], []).allowed, false);
  assert.equal(matchBusiness(businessKeys({ email: "jo@gmail.com", website: "jos-utes.com.au" }), [dnc], []).allowed, true);
});

test("Kyle's exclusions block, and the connector is given no reason", () => {
  const v = matchBusiness(catten, [record("exclusion", { domain: "catten.com.au" }, "Exclusion: Catten")], []);
  assert.equal(v.allowed, false);
  assert.equal(v.blocks[0].source, "exclusion");
  assert.deepEqual(publicVerdict(v), { allowed: false, reasons: [] });
  // Even alongside another reason.
  const both = matchBusiness(
    catten,
    [record("exclusion", { domain: "catten.com.au" }), record("lead", { name: "Catten Industries" })],
    [],
  );
  assert.deepEqual(publicVerdict(both), { allowed: false, reasons: [] });
});

test("another prospect blocks", () => {
  const v = matchBusiness(catten, [record("prospect", { domain: "catten.com.au" })], []);
  assert.equal(v.allowed, false);
  assert.deepEqual(publicVerdict(v), { allowed: false, reasons: ["already a prospect"] });
});

test("the connector's reasons never carry names", () => {
  const v = matchBusiness(catten, [record("lead", { name: "Catten Industries" }, "Lead: Catten Industries")], [{ kind: "abn", reason: "contacted" }]);
  const p = publicVerdict(v);
  assert.equal(p.allowed, false);
  assert.deepEqual(p.reasons.sort(), ["already in the pipeline", "contacted before, or asked not to be"]);
  assert.ok(!JSON.stringify(p).includes("Catten"));
});

test("nothing to check against means not allowed", () => {
  const v = matchBusiness([], [], []);
  assert.equal(v.allowed, false);
  assert.ok(v.problem);
  assert.equal(publicVerdict(v).allowed, false);
});
