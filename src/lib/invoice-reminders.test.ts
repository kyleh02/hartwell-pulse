import { test } from "node:test";
import assert from "node:assert/strict";
import { daysOverdue, melbourneDay, reminderDue } from "./invoice-reminders.ts";

const at = (iso: string) => new Date(iso);

test("first gentle, then firmer two Melbourne days later, then weekly", () => {
  // Never reminded: the gentle nudge.
  assert.deepEqual(reminderDue(0, null, at("2026-11-21T08:00:00Z")), { due: true, tone: "gentle" });
  // First sent Saturday 7:18pm Melbourne; the firmer one is due all Monday,
  // including 2pm Monday (the case that sent nothing when hours were counted).
  assert.deepEqual(reminderDue(1, "2026-11-21T08:18:37Z", at("2026-11-23T03:03:00Z")), { due: true, tone: "urgent" });
  assert.equal(reminderDue(1, "2026-11-21T08:18:37Z", at("2026-11-22T12:00:00Z")).due, false);
  // Two or more: the firm one, weekly.
  assert.equal(reminderDue(2, "2026-11-23T03:00:00Z", at("2026-11-29T08:00:00Z")).due, false);
  assert.deepEqual(reminderDue(2, "2026-11-23T03:00:00Z", at("2026-11-30T08:00:00Z")), { due: true, tone: "urgent" });
});

test("before migration 0069 the old weekly gentle rule stands", () => {
  assert.deepEqual(reminderDue(undefined, null, at("2026-11-21T08:00:00Z")), { due: true, tone: "gentle" });
  assert.equal(reminderDue(undefined, "2026-11-21T08:00:00Z", at("2026-11-23T08:00:00Z")).due, false);
  assert.equal(reminderDue(undefined, "2026-11-21T08:00:00Z", at("2026-11-28T08:00:00Z")).due, true);
});

test("Melbourne days and days overdue", () => {
  assert.equal(melbourneDay("2026-11-21T08:18:37Z"), "2026-11-21");
  assert.equal(melbourneDay("2026-11-22T14:00:00Z"), "2026-11-23");
  assert.equal(daysOverdue("2026-11-20", "2026-11-23"), 3);
  assert.equal(daysOverdue("2026-11-24", "2026-11-23"), 0);
});
