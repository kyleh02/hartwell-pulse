import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTREACH, OUTREACH_ADVISOR, PIPELINE, resourceFor, resourceForMetadataPath, tokenFits } from "./resources.ts";

const O = "https://portal.hartwelldigital.com";

test("the pipeline connector keeps working exactly as before", () => {
  assert.equal(resourceFor(O, {}, true), PIPELINE);
  assert.equal(resourceFor(O, { scope: "pipeline" }, true), PIPELINE);
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp` }, true), PIPELINE);
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp/` }, true), PIPELINE);
  assert.equal(resourceFor(O, { resource: O }, true), PIPELINE);
  assert.equal(resourceFor(O, { resource: O, scope: "pipeline" }, false), PIPELINE);
});

test("Draper's two addresses each get their own resource and scope", () => {
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp/outreach` }, true), OUTREACH);
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp/outreach`, scope: "outreach" }, true), OUTREACH);
  assert.equal(resourceFor(O, { scope: "outreach" }, true), OUTREACH);
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp/outreach-advisor` }, true), OUTREACH_ADVISOR);
  assert.equal(resourceFor(O, { resource: O, scope: "outreach-advisor" }, true), OUTREACH_ADVISOR);
  // A client asking for every listed scope still gets the address it named, and only that.
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp/outreach`, scope: "pipeline outreach outreach-advisor" }, true), OUTREACH);
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp`, scope: "pipeline outreach outreach-advisor" }, true), PIPELINE);
});

test("a mismatch, an unknown address or scope, or Draper switched off is refused", () => {
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp/outreach`, scope: "pipeline" }, true), null);
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp`, scope: "outreach" }, true), null);
  assert.equal(resourceFor(O, { scope: "outreach pipeline" }, true), null);
  assert.equal(resourceFor(O, { scope: "admin" }, true), null);
  assert.equal(resourceFor(O, { resource: "https://evil.example/api/mcp" }, true), null);
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp/other` }, true), null);
  assert.equal(resourceFor(O, { resource: `${O}/api/mcp/outreach` }, false), null);
  assert.equal(resourceFor(O, { scope: "outreach" }, false), null);
});

test("a token works only at the address it was issued for", () => {
  const draper = `${O}/api/mcp/outreach`;
  assert.equal(tokenFits(draper, O, OUTREACH), true);
  assert.equal(tokenFits(draper, O, PIPELINE), false); // refused by /api/mcp
  assert.equal(tokenFits(draper, O, OUTREACH_ADVISOR), false); // and by the advisor
  assert.equal(tokenFits(`${O}/api/mcp`, O, OUTREACH), false); // the pipeline's can't reach Draper
  assert.equal(tokenFits(`${O}/api/mcp/outreach-advisor`, O, OUTREACH), false);
  assert.equal(tokenFits(draper, "https://other.vercel.app", OUTREACH), false); // nor on another host
});

test("each protected-resource document names its own resource", () => {
  assert.equal(resourceForMetadataPath(undefined, true), PIPELINE);
  assert.equal(resourceForMetadataPath(["api", "mcp"], true), PIPELINE);
  assert.equal(resourceForMetadataPath(["api", "mcp", "outreach"], true), OUTREACH);
  assert.equal(resourceForMetadataPath(["api", "mcp", "outreach-advisor"], true), OUTREACH_ADVISOR);
  assert.equal(resourceForMetadataPath(["api", "mcp", "outreach"], false), null);
  assert.equal(resourceForMetadataPath(["nope"], true), null);
});
