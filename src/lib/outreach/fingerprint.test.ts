import { test } from "node:test";
import assert from "node:assert/strict";
import { hashKey } from "./fingerprint.ts";

test("the fingerprint hash never changes", () => {
  // Pinned. If this fails, every stored fingerprint has stopped matching.
  assert.equal(
    hashKey({ kind: "domain", value: "catten.com.au" }),
    "6a4f5507b8ce9c02478703a3555d060c2b90e552e4f9c9a0036412bed5353106",
  );
});

test("the kind is part of the hash", () => {
  assert.notEqual(hashKey({ kind: "domain", value: "x" }), hashKey({ kind: "name", value: "x" }));
});
