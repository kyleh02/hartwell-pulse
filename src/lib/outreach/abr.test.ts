import { test } from "node:test";
import assert from "node:assert/strict";
import { abnNameMatches, lookupAbn, parseAbrResponse } from "./abr.ts";

const ACTIVE = `callback({"Abn":"51824753556","AbnStatus":"Active","AbnStatusEffectiveFrom":"2000-07-01","Acn":"","AddressDate":"2020-01-01","AddressPostcode":"3061","AddressState":"VIC","BusinessName":["Catten Canopies"],"EntityName":"CATTEN INDUSTRIES PTY LTD","EntityTypeCode":"PRV","EntityTypeName":"Australian Private Company","Gst":"2000-07-01","Message":""})`;

test("an active ABN, its names, GST and address", () => {
  const r = parseAbrResponse(ACTIVE);
  assert.ok(!("error" in r));
  if ("error" in r) return;
  assert.equal(r.abn, "51824753556");
  assert.equal(r.status, "active");
  assert.equal(r.entityName, "CATTEN INDUSTRIES PTY LTD");
  assert.deepEqual(r.businessNames, ["Catten Canopies"]);
  assert.equal(r.gstRegistered, true);
  assert.equal(r.state, "VIC");
  assert.equal(r.postcode, "3061");
});

test("cancelled, not registered for GST", () => {
  const r = parseAbrResponse(ACTIVE.replace('"Active"', '"Cancelled"').replace('"Gst":"2000-07-01"', '"Gst":null'));
  assert.ok(!("error" in r) && r.status === "cancelled" && r.gstRegistered === false);
});

test("an unknown ABN, and a refusal", () => {
  const nf = parseAbrResponse(`callback({"Abn":"","AbnStatus":"","Message":"Search text is not a valid ABN or ACN"})`);
  assert.ok(!("error" in nf) && nf.status === "not_found");
  const bad = parseAbrResponse(`callback({"Abn":"","Message":"The GUID entered is not recognised as a Registered Party"})`);
  assert.ok("error" in bad);
  assert.ok("error" in parseAbrResponse("<html>oops</html>"));
});

test("the name must match the entity or a registered business name, exactly", () => {
  const r = parseAbrResponse(ACTIVE);
  if ("error" in r) throw new Error("parse");
  assert.equal(abnNameMatches(r, "Catten Industries"), true);
  assert.equal(abnNameMatches(r, "Catten Canopies Pty Ltd"), true);
  assert.equal(abnNameMatches(r, "Catten"), false);
  assert.equal(abnNameMatches(r, null), false);
});

test("without ABR_GUID nothing is fetched, and a bad ABN is refused first", async () => {
  assert.deepEqual(await lookupAbn("51 824 753 556", "Catten", ""), {
    checked: false,
    reason: "ABR_GUID isn't set, so the ABN was not checked by Pulse",
  });
  const bad = await lookupAbn("12 345 678 901", "x", "guid");
  assert.equal(bad.checked, false);
});
