import { test } from "node:test";
import assert from "node:assert/strict";
import { clientAreaBlocks, postcodeDistanceKm, postcodePlace, serviceWords } from "./geo.ts";

test("postcodes are on file with their state", () => {
  assert.equal(postcodePlace("4551")?.state, "QLD"); // Caloundra
  assert.equal(postcodePlace("3061")?.state, "VIC"); // Campbellfield
  assert.equal(postcodePlace("2000")?.state, "NSW");
  assert.equal(postcodePlace("9999"), null);
  assert.equal(postcodePlace("abc"), null);
  assert.equal(postcodePlace(null), null);
});

test("distances are about right", () => {
  // Melbourne CBD to Campbellfield: roughly 16 km.
  const cbd = postcodeDistanceKm("3000", "3061")!;
  assert.ok(cbd > 12 && cbd < 20, String(cbd));
  // Caloundra to Maroochydore: roughly 20 km.
  const coast = postcodeDistanceKm("4551", "4558")!;
  assert.ok(coast > 14 && coast < 26, String(coast));
  // Melbourne to Brisbane: well over 1,000 km.
  assert.ok(postcodeDistanceKm("3000", "4000")! > 1300);
  assert.equal(postcodeDistanceKm("3000", "3000"), 0);
  assert.equal(postcodeDistanceKm("3000", "9999"), null);
});

test("service words drop the generic ones and plurals", () => {
  assert.deepEqual([...serviceWords(["Reformer Pilates studio"])].sort(), ["pilate", "reformer"]);
  assert.deepEqual([...serviceWords(["Marquee & tent hire"])].sort(), ["marquee", "tent"]);
  assert.deepEqual([...serviceWords(["Ute trays", "ute tray"])], ["ute", "tray"]);
});

const pilatesClient = { label: "Client: Core Studio", postcode: "4551", services: ["reformer pilates"], radiusKm: 15 };

test("a competitor nearby is skipped", () => {
  const blocks = clientAreaBlocks({ postcode: "4551", services: ["Pilates and yoga"] }, [pilatesClient]);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0].label, /Core Studio \(0 km away\)/);
});

test("the same trade further away, or a different trade nearby, is fine", () => {
  assert.deepEqual(clientAreaBlocks({ postcode: "3000", services: ["pilates"] }, [pilatesClient]), []);
  assert.deepEqual(clientAreaBlocks({ postcode: "4551", services: ["float centre"] }, [pilatesClient]), []);
});

test("the radius is the client area's own", () => {
  const wide = { ...pilatesClient, radiusKm: 40 };
  assert.equal(clientAreaBlocks({ postcode: "4558", services: ["pilates"] }, [pilatesClient]).length, 0);
  assert.equal(clientAreaBlocks({ postcode: "4558", services: ["pilates"] }, [wide]).length, 1);
});

test("a client area with no services covers everything in its radius", () => {
  const all = { ...pilatesClient, services: [] };
  assert.equal(clientAreaBlocks({ postcode: "4551", services: ["ute trays"] }, [all]).length, 1);
});

test("an unknown prospect postcode is blocked while client areas exist", () => {
  assert.equal(clientAreaBlocks({ postcode: "9999", services: ["pilates"] }, [pilatesClient]).length, 1);
  assert.equal(clientAreaBlocks({ postcode: null, services: ["pilates"] }, [pilatesClient]).length, 1);
  // With no client areas there is nothing to be near.
  assert.deepEqual(clientAreaBlocks({ postcode: null, services: [] }, []), []);
});
