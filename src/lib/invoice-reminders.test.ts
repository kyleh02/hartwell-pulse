import { test } from "node:test";
import assert from "node:assert/strict";
import { daysOverdue, reminderDue } from "./invoice-reminders.ts";

const at = (iso: string) => new Date(iso);

test("first gentle, then firmer two days later, then weekly", () => {
  // Never reminded: the gentle nudge.
  assert.deepEqual(reminderDue(0, null, at("2026-11-21T08:00:00Z")), { due: true, tone: "gentle" });
  // One sent: firmer two days on (the daily run a few minutes early still counts).
  assert.deepEqual(reminderDue(1, "2026-11-21T08:03:00Z", at("2026-11-23T08:00:00Z")), { due: true, tone: "urgent" });
  assert.equal(reminderDue(1, "2026-11-21T08:00:00Z", at("2026-11-22T08:00:00Z")).due, false);
  // Two or more: the firm one, weekly.
  assert.equal(reminderDue(2, "2026-11-23T08:00:00Z", at("2026-11-25T08:00:00Z")).due, false);
  assert.deepEqual(reminderDue(2, "2026-11-23T08:00:00Z", at("2026-11-30T08:00:00Z")), { due: true, tone: "urgent" });
});

test("before migration 0069 the old weekly gentle rule stands", () => {
  assert.deepEqual(reminderDue(undefined, null, at("2026-11-21T08:00:00Z")), { due: true, tone: "gentle" });
  assert.equal(reminderDue(undefined, "2026-11-21T08:00:00Z", at("2026-11-23T08:00:00Z")).due, false);
  assert.equal(reminderDue(undefined, "2026-11-21T08:00:00Z", at("2026-11-28T08:00:00Z")).due, true);
});

test("days overdue", () => {
  assert.equal(daysOverdue("2026-11-20", "2026-11-23"), 3);
  assert.equal(daysOverdue("2026-11-24", "2026-11-23"), 0);
});
