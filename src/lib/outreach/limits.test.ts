import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FIRST_EMAILS_A_DAY,
  MAX_SENDS_A_DAY,
  firstEmailCap,
  firstEmailsToday,
  isCheckThese,
  rampCap,
} from "./limits.ts";

test("the ramp: 10, 15 and 20, five sending days each, then the slider", () => {
  const caps = Array.from({ length: 17 }, (_, done) => rampCap(done));
  assert.deepEqual(caps.slice(0, 5), [10, 10, 10, 10, 10]);
  assert.deepEqual(caps.slice(5, 10), [15, 15, 15, 15, 15]);
  assert.deepEqual(caps.slice(10, 15), [20, 20, 20, 20, 20]);
  assert.equal(caps[15], null);
  assert.equal(caps[16], null);
});

test("the cap is the lower of the slider and the ramp", () => {
  assert.equal(firstEmailCap(25, 0), 10);
  assert.equal(firstEmailCap(3, 0), 3);
  assert.equal(firstEmailCap(25, 7), 15);
  assert.equal(firstEmailCap(25, 12), 20);
  assert.equal(firstEmailCap(25, 15), 25);
  assert.equal(firstEmailCap(12, 40), 12);
});

test("the slider can't go past 25, or below 1", () => {
  assert.equal(firstEmailCap(26, 100), MAX_FIRST_EMAILS_A_DAY);
  assert.equal(firstEmailCap(1000, 100), 25);
  assert.equal(firstEmailCap(0, 100), 1);
  assert.equal(firstEmailCap(-5, 100), 1);
  assert.equal(firstEmailCap(Number.NaN, 100), 1);
  assert.equal(firstEmailCap(Number.POSITIVE_INFINITY, 100), 1);
});

test("follow-ups come first: first emails give way past 50 sends", () => {
  assert.equal(firstEmailsToday(25, 0), 25);
  assert.equal(firstEmailsToday(25, 25), 25);
  assert.equal(firstEmailsToday(25, 30), 20);
  assert.equal(firstEmailsToday(25, MAX_SENDS_A_DAY), 0);
  assert.equal(firstEmailsToday(25, 80), 0);
});

test("the ceilings hold even when handed a bad cap", () => {
  assert.equal(firstEmailsToday(99, 0), 25);
  assert.equal(firstEmailsToday(-3, 0), 0);
  assert.equal(firstEmailsToday(Number.NaN, 0), 0);
  // A follow-up count that is not a number is treated as a full day.
  assert.equal(firstEmailsToday(25, Number.NaN), 0);
});

test("from the 13th first email of the day, it goes in Check these", () => {
  assert.equal(isCheckThese(1), false);
  assert.equal(isCheckThese(12), false);
  assert.equal(isCheckThese(13), true);
  assert.equal(isCheckThese(25), true);
});
