import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mxProvider } from "./mx.ts";

/**
 * Stage 7's promise, held by reading the connector's own source: Draper's
 * tools touch only Draper's tables, never clients, invoices, the exclusions
 * or the pipeline's own tables, can't send, and the three advisor writes
 * stay advisor only. Business checks still read clients and exclusions, but
 * inside check.ts, and only "allowed or blocked" comes back (publicVerdict).
 */
const src = readFileSync(fileURLToPath(new URL("./mcp-tools.ts", import.meta.url)), "utf8");

const ALLOWED = new Set([
  "outreach_settings",
  "outreach_lanes",
  "outreach_state",
  "outreach_prospects",
  "outreach_contacts",
  "outreach_measurements",
  "outreach_messages",
  "outreach_replies",
  "outreach_events",
  "outreach_templates",
  "outreach_run_instructions",
  "outreach_lessons",
  "outreach_tests",
  "outreach_change_log",
  "outreach_runs",
]);

test("the connector's tools read and write only Draper's own tables", () => {
  const tables = [...src.matchAll(/\.from\(\s*"([a-z_]+)"\s*\)/g)].map((m) => m[1]);
  assert.ok(tables.length > 10);
  for (const t of tables) assert.ok(ALLOWED.has(t), `the connector touches ${t}`);
  // newVersion() writes to a table passed in: only these two.
  assert.match(src, /table: "outreach_lessons" \| "outreach_run_instructions"/);
  for (const bad of ["clients", "invoices", "outreach_exclusions", "do_not_contact", "leads", "mcp_tokens", "outreach_gmail"]) {
    assert.ok(!new RegExp(`from\\(\\s*"${bad}"`).test(src), `reads ${bad}`);
  }
});

test("it can't send, and its business check only ever says allowed or blocked", () => {
  assert.ok(!/sendRaw|buildMessage|gmail-access|from "\.\/gmail\.ts"|sender\.ts/.test(src), "imports the sending path");
  assert.ok(!/verdict\.blocks/.test(src), "hands block details back");
  assert.equal((src.match(/publicVerdict\(/g) ?? []).length, 2);
  // One delete only: a prospect it inserted a moment earlier whose contact failed to save.
  assert.equal((src.match(/\.delete\(\)/g) ?? []).length, 1);
  assert.match(src, /if \(cErr\) \{\s*await ctx\.sb\.from\("outreach_prospects"\)\.delete\(\)\.eq\("id", id\);/);
});

test("the advisor's three writes are advisor only", () => {
  for (const name of ["outreach_set_lessons", "outreach_set_run_instructions", "outreach_set_test"]) {
    const at = src.indexOf(`name: "${name}"`);
    assert.ok(at > 0, name);
    const next = src.indexOf("name: \"outreach_", at + 10);
    const block = src.slice(at, next > 0 ? next : undefined);
    assert.match(block, /advisorOnly: true/, `${name} isn't marked advisor only`);
  }
  const morning = [...src.matchAll(/name: "(outreach_[a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(morning.slice(0, 10), [
    "outreach_brief",
    "outreach_check_business",
    "outreach_add_prospect",
    "outreach_measure",
    "outreach_submit",
    "outreach_drop",
    "outreach_replies_to_label",
    "outreach_label_reply",
    "outreach_numbers",
    "outreach_finish_run",
  ]);
  // The run report is the morning run's own; it isn't an advisor write.
  const at = src.indexOf('name: "outreach_finish_run"');
  assert.ok(!/advisorOnly: true/.test(src.slice(at, src.indexOf('name: "outreach_set_lessons"'))));
});

test("an address's mail provider, from its MX records", () => {
  assert.equal(mxProvider(["aspmx.l.google.com.", "alt1.aspmx.l.google.com"]), "google");
  assert.equal(mxProvider(["catten-com-au.mail.protection.outlook.com"]), "microsoft");
  assert.equal(mxProvider(["mx1.mailchannels.net"]), "other");
  assert.equal(mxProvider([]), null);
});
