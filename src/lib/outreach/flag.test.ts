import { test } from "node:test";
import assert from "node:assert/strict";
import { outreachEnabled } from "./flag.ts";

test("Draper is off unless OUTREACH_ENABLED is true", () => {
  assert.equal(outreachEnabled({}), false);
  assert.equal(outreachEnabled({ OUTREACH_ENABLED: "" }), false);
  assert.equal(outreachEnabled({ OUTREACH_ENABLED: "false" }), false);
  assert.equal(outreachEnabled({ OUTREACH_ENABLED: "1" }), false);
  assert.equal(outreachEnabled({ OUTREACH_ENABLED: "yes" }), false);
  assert.equal(outreachEnabled({ OUTREACH_ENABLED: "tru" }), false);
});

test("true turns it on, whatever the case or stray spaces", () => {
  assert.equal(outreachEnabled({ OUTREACH_ENABLED: "true" }), true);
  assert.equal(outreachEnabled({ OUTREACH_ENABLED: "TRUE" }), true);
  assert.equal(outreachEnabled({ OUTREACH_ENABLED: " true \n" }), true);
});
