import { test } from "node:test";
import assert from "node:assert/strict";
import {
  followUpDay,
  melbourneDate,
  melbourneInstant,
  melbourneTime,
  nextSendingDay,
  planDay,
  recipientFor,
  sendingDay,
  type Calendar,
} from "./schedule.ts";
import { sealToken, openToken, tokenKey } from "./crypto.ts";
import { buildMessage, encodeHeader } from "./gmail.ts";

// A made-up holiday table, so the rules are tested apart from the real dates.
const cal: Calendar = {
  holidays: {
    "2026": { VIC: ["2026-11-03"], QLD: ["2026-11-24"], NSW: [] },
    "2027": { VIC: ["2027-01-01", "2027-01-26"], QLD: ["2027-01-01", "2027-01-26"] },
  },
  pauseFrom: "2026-12-18",
  pauseTo: "2027-01-11",
};

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

test("sending days: weekdays, not holidays here or there, not paused, only covered years", () => {
  assert.deepEqual(sendingDay("2026-11-23", "QLD", cal), { ok: true }); // a Monday
  assert.equal(sendingDay("2026-11-21", null, cal).ok, false); // Saturday
  assert.equal(sendingDay("2026-11-03", "QLD", cal).ok, false); // Melbourne Cup in Victoria
  assert.equal(sendingDay("2026-11-24", "QLD", cal).ok, false); // a Queensland holiday...
  assert.equal(sendingDay("2026-11-24", "NSW", cal).ok, true); // ...but not in New South Wales
  assert.equal(sendingDay("2026-12-21", null, cal).ok, false); // pause dates
  assert.equal(sendingDay("2027-01-12", null, cal).ok, true); // the day after the pause
  const uncovered = sendingDay("2028-03-01", null, cal);
  assert.equal(uncovered.ok, false);
  assert.match(uncovered.ok ? "" : uncovered.reason, /no public holiday dates are loaded for 2028/);
});

test("the next sending day skips weekends, holidays and the pause", () => {
  assert.equal(nextSendingDay("2026-11-20", null, cal), "2026-11-23"); // Friday to Monday
  assert.equal(nextSendingDay("2026-11-02", null, cal), "2026-11-04"); // over the Cup
  assert.equal(nextSendingDay("2026-12-17", null, cal), "2027-01-12"); // over the pause
  assert.equal(nextSendingDay("2027-12-31", null, cal), null); // 2028 isn't covered
});

test("the follow-up goes on day 7, or the next sending day after it", () => {
  assert.equal(followUpDay("2026-11-16", null, cal), "2026-11-23");
  assert.equal(followUpDay("2026-11-17", "QLD", cal), "2026-11-25"); // day 7 is a QLD holiday
  assert.equal(followUpDay("2026-12-14", null, cal), "2027-01-12"); // into the pause
});

test("Melbourne time, across daylight saving", () => {
  assert.equal(melbourneInstant("2026-11-23", "09:30").toISOString(), "2026-11-22T22:30:00.000Z"); // AEDT
  assert.equal(melbourneInstant("2026-06-15", "09:30").toISOString(), "2026-06-14T23:30:00.000Z"); // AEST
  const at = new Date("2026-11-22T22:30:00Z");
  assert.equal(melbourneDate(at), "2026-11-23");
  assert.equal(melbourneTime(at), "09:30");
});

test("a day's plan: after the stop window, 20 to 45 minutes apart, inside the window", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}` }));
  const p = planDay({ date: "2026-11-23", windowStart: "09:30", windowEnd: "15:30", gapMin: 20, gapMax: 45, stopWindowMinutes: 90, items, random: seeded(7) });
  assert.equal(p.rolledOver.length, 0);
  const local = p.times.map((t) => melbourneTime(t.at));
  assert.ok(local[0] >= "09:30" && local[0] <= "09:40", local[0]);
  for (let i = 1; i < p.times.length; i++) {
    const gap = (p.times[i].at.getTime() - p.times[i - 1].at.getTime()) / 60_000;
    assert.ok(gap >= 20 && gap <= 45, `gap ${gap}`);
  }
});

test("a longer stop window holds the first send back", () => {
  const p = planDay({ date: "2026-11-23", windowStart: "09:30", windowEnd: "15:30", gapMin: 20, gapMax: 45, stopWindowMinutes: 150, items: [{ id: "a" }], random: () => 0 });
  assert.equal(melbourneTime(p.times[0].at), "10:30");
  const none = planDay({ date: "2026-11-23", windowStart: "09:30", windowEnd: "15:30", gapMin: 20, gapMax: 45, stopWindowMinutes: 0, items: [{ id: "a" }], random: () => 0 });
  assert.equal(melbourneTime(none.times[0].at), "09:30");
});

test("Check these wait for 12:30, and what won't fit by 3:30 rolls over", () => {
  const items = [{ id: "a" }, { id: "b", notBefore: "12:30" }];
  const p = planDay({ date: "2026-11-23", windowStart: "09:30", windowEnd: "15:30", gapMin: 20, gapMax: 45, stopWindowMinutes: 90, items, random: () => 0 });
  assert.equal(melbourneTime(p.times[1].at), "12:30");
  // 25 sends at least 20 minutes apart can't fit six hours.
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}` }));
  const full = planDay({ date: "2026-11-23", windowStart: "09:30", windowEnd: "15:30", gapMin: 20, gapMax: 45, stopWindowMinutes: 90, items: many, random: () => 0 });
  assert.equal(full.times.length, 19); // 9:30, then every 20 minutes to 15:30
  assert.equal(full.rolledOver.length, 6);
  assert.equal(melbourneTime(full.times[18].at), "15:30");
});

test("who it goes to: test inboxes in test mode, a business only with master on and test mode off", () => {
  const inboxes = ["kyle.test@gmail.com", "kyle.test@outlook.com"];
  assert.deepEqual(recipientFor({ master_on: false, test_mode: true, test_inboxes: inboxes }, "sam@catten.com.au", 0), { to: inboxes[0], test: true });
  assert.deepEqual(recipientFor({ master_on: true, test_mode: true, test_inboxes: inboxes }, "sam@catten.com.au", 1), { to: inboxes[1], test: true });
  assert.ok("blocked" in recipientFor({ master_on: false, test_mode: true, test_inboxes: [] }, "sam@catten.com.au", 0));
  assert.ok("blocked" in recipientFor({ master_on: false, test_mode: false, test_inboxes: inboxes }, "sam@catten.com.au", 0));
  assert.deepEqual(recipientFor({ master_on: true, test_mode: false, test_inboxes: inboxes }, "sam@catten.com.au", 0), { to: "sam@catten.com.au", test: false });
});

test("the Gmail token is sealed, and a tampered or wrong-key token won't open", () => {
  const key = tokenKey(Buffer.alloc(32, 7).toString("base64"))!;
  const sealed = sealToken("1//refresh-token", key);
  assert.equal(openToken(sealed, key), "1//refresh-token");
  assert.notEqual(sealToken("1//refresh-token", key), sealed); // a fresh iv each time
  const bad = Buffer.from(sealed, "base64");
  bad[20] ^= 1;
  assert.throws(() => openToken(bad.toString("base64"), key));
  assert.throws(() => openToken(sealed, tokenKey(Buffer.alloc(32, 8).toString("base64"))!));
  assert.equal(tokenKey("too-short"), null);
  assert.equal(tokenKey(undefined), null);
});

test("the email: plain text from Kyle Hartwell, CRLF, threaded when it's a follow-up", () => {
  const raw = buildMessage({
    to: "sam@catten.com.au",
    subject: "your canopy page",
    body: "Hi Sam,\n\nOne line.\n\nKyle Hartwell",
    messageId: "<abc@hartwelldigital.com>",
    date: new Date("2026-11-23T22:31:00Z"),
  });
  const text = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(text, /^From: "Kyle Hartwell" <kyle@hartwelldigital\.com>\r\nTo: sam@catten\.com\.au\r\nSubject: your canopy page\r\n/);
  assert.match(text, /Date: Mon, 23 Nov 2026 22:31:00 \+0000\r\n/);
  assert.match(text, /Content-Type: text\/plain; charset=UTF-8\r\n/);
  assert.ok(text.endsWith("\r\n\r\nHi Sam,\r\n\r\nOne line.\r\n\r\nKyle Hartwell\r\n"));
  assert.ok(!/text\/html|<a |http/.test(text));

  const reply = Buffer.from(
    buildMessage({ to: "sam@catten.com.au", subject: "Re: your canopy page", body: "x", messageId: "<def@hartwelldigital.com>", inReplyTo: "<abc@hartwelldigital.com>" }),
    "base64url",
  ).toString("utf8");
  assert.match(reply, /In-Reply-To: <abc@hartwelldigital\.com>\r\nReferences: <abc@hartwelldigital\.com>\r\n/);
  // A header can't be split to smuggle in another.
  assert.equal(encodeHeader("a\r\nBcc: x@y.z"), "a Bcc: x@y.z");
  assert.equal(encodeHeader("café"), "=?UTF-8?B?Y2Fmw6k=?=");
});

test("a queue fixed late still gets its full stop window", () => {
  const p = planDay({ date: "2026-11-23", windowStart: "09:30", windowEnd: "15:30", gapMin: 20, gapMax: 45, stopWindowMinutes: 90, fixedAt: "10:15", items: [{ id: "a" }], random: () => 0 });
  assert.equal(melbourneTime(p.times[0].at), "11:45");
});

