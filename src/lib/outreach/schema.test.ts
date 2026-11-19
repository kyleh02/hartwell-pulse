/**
 * The code and the database must agree. These read 0062 itself and check its
 * constraints against the lists in rules.ts and the numbers in limits.ts, and
 * that the safety rules written into the migration are still there. The live
 * database is checked by supabase/probes/0062_draper_probe.sql.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AU_STATES,
  DEFENCE_LANE,
  EVENT_KINDS,
  FAULTS,
  FINGERPRINT_KINDS,
  FINGERPRINT_REASONS,
  MEASUREMENT_PURPOSES,
  MESSAGE_KINDS,
  MESSAGE_STATUSES,
  PROSPECT_STATUSES,
  REPLY_KINDS,
  REPLY_LABELS,
} from "./rules.ts";
import { MAX_FIRST_EMAILS_A_DAY } from "./limits.ts";

const sql = readFileSync(
  new URL("../../../supabase/migrations/0062_draper.sql", import.meta.url),
  "utf8",
).replace(/\r/g, "");

/** The quoted values in a named constraint, which sits on one line. */
function constraintValues(name: string): string[] {
  const line = sql.split("\n").find((l) => l.includes(`constraint ${name} `));
  assert.ok(line, `constraint ${name} is missing from 0062`);
  // From the constraint on, so a column default on the same line is skipped.
  const check = line.slice(line.indexOf(`constraint ${name} `));
  return [...check.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

const same = (a: readonly string[], b: readonly string[]) =>
  assert.deepEqual([...a].sort(), [...b].sort());

test("every list in rules.ts matches its check constraint", () => {
  same(constraintValues("outreach_prospects_status_check"), PROSPECT_STATUSES);
  same(constraintValues("outreach_messages_status_check"), MESSAGE_STATUSES);
  same(constraintValues("outreach_messages_kind_check"), MESSAGE_KINDS);
  same(constraintValues("outreach_messages_fault_check"), FAULTS);
  same(constraintValues("outreach_measurements_faults_check"), FAULTS);
  same(constraintValues("outreach_claims_fault_check"), FAULTS);
  same(constraintValues("outreach_state_faults_check"), FAULTS);
  same(constraintValues("outreach_measurements_purpose_check"), MEASUREMENT_PURPOSES);
  same(constraintValues("outreach_replies_label_check"), REPLY_LABELS);
  same(constraintValues("outreach_replies_kind_check"), REPLY_KINDS);
  same(constraintValues("outreach_events_kind_check"), EVENT_KINDS);
  same(constraintValues("outreach_fingerprints_kind_check"), FINGERPRINT_KINDS);
  same(constraintValues("outreach_fingerprints_reason_check"), FINGERPRINT_REASONS);
  same(constraintValues("outreach_prospects_state_check"), AU_STATES);
});

test("the database caps the slider at the code's ceiling", () => {
  const line = sql.split("\n").find((l) => l.includes("constraint outreach_settings_daily_check"));
  assert.ok(line);
  assert.match(line, new RegExp(`between 1 and ${MAX_FIRST_EMAILS_A_DAY}\\b`));
});

test("settings start safe: master switch off, test mode on", () => {
  assert.match(sql, /master_on boolean not null default false/);
  assert.match(sql, /test_mode boolean not null default true/);
});

test("the defence lane is refused and never seeded", () => {
  assert.match(sql, new RegExp(`constraint outreach_lanes_no_defence check \\(id <> ${DEFENCE_LANE}\\)`));
  const seeded = [...sql.matchAll(/^\(\n\s+(\d+), '/gm)].map((m) => Number(m[1]));
  assert.deepEqual(seeded, [1, 2, 3, 5]);
});

test("fingerprints can only ever be added to", () => {
  assert.match(sql, /'outreach_fingerprints', 'outreach_settings', 'outreach_templates',/);
  assert.match(sql, /before update or delete on public\.%I for each row execute function public\.outreach_refuse_change\(\)/);
  assert.match(sql, /before truncate on public\.%I for each statement execute function public\.outreach_refuse_change\(\)/);
  // Admins may read and add, nothing more.
  const addOnly = sql.slice(sql.indexOf("add_only text[] := array["), sql.indexOf("read_only text[]"));
  assert.match(addOnly, /'outreach_fingerprints'/);
});

test("one first email and at most one follow-up per business", () => {
  assert.match(sql, /constraint outreach_messages_one_each unique \(prospect_id, kind\)/);
});

test("no table is left without row-level security", () => {
  const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  const locked = sql.slice(sql.indexOf("-- ---------- 16."), sql.indexOf("-- ---------- 17."));
  for (const t of created) assert.match(locked, new RegExp(`'${t}'`), `${t} has no RLS entry`);
});
