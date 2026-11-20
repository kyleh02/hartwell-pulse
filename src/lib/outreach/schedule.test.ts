import { test } from "node:test";
import assert from "node:assert/strict";
import {
  easterSunday,
  followUpDay,
  holidayOn,
  melbourneDate,
  melbourneInstant,
  melbourneTime,
  nationalHolidays,
  nextSendingDay,
  planDay,
  recipientFor,
  sendingDay,
  type Calendar,
} from "./schedule.ts";
import { sealToken, openToken, tokenKey } from "./crypto.ts";
import { buildMessage, encodeHeader, quotedPrintable } from "./gmail.ts";

const cal: Calendar = { pauseFrom: "2026-12-18", pauseTo: "2027-01-11" };

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

test("Easter, worked out for any year", () => {
  assert.equal(easterSunday(2024), "2024-03-31");
  assert.equal(easterSunday(2025), "2025-04-20");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(easterSunday(2028), "2028-04-16");
});

test("only the big national holidays stop sending, with their weekday stand-ins", () => {
  assert.deepEqual([...nationalHolidays(2026).keys()].sort(), [
    "2026-01-01", // New Year's Day
    "2026-01-26", // Australia Day
    "2026-04-03", // Good Friday
    "2026-04-06", // Easter Monday
    "2026-04-25", // Anzac Day (a Saturday: no stand-in)
    "2026-12-25", // Christmas Day
    "2026-12-26", // Boxing Day, a Saturday...
    "2026-12-28", // ...so the Monday
  ]);
  // 2027: Christmas on a Saturday and Boxing Day on a Sunday move to Monday and Tuesday.
  assert.equal(holidayOn("2027-12-27"), "Christmas Day (the weekday it moves to)");
  assert.equal(holidayOn("2027-12-28"), "Boxing Day (the weekday it moves to)");
  // 2022: Christmas on a Sunday steps past Boxing Day's Monday to the Tuesday.
  assert.equal(holidayOn("2022-12-26"), "Boxing Day");
  assert.equal(holidayOn("2022-12-27"), "Christmas Day (the weekday it moves to)");
  assert.equal(holidayOn("2028-01-03"), "New Year's Day (the weekday it moves to)");
  // State holidays are sending days now (Kyle, 20 Nov 2026).
  assert.equal(holidayOn("2026-11-03"), null); // Melbourne Cup
  assert.equal(holidayOn("2026-06-08"), null); // not a national holiday
});

test("sending days: weekdays, not a national holiday, not paused, in any year", () => {
  assert.deepEqual(sendingDay("2026-11-23", "QLD", cal), { ok: true }); // a Monday
  assert.equal(sendingDay("2026-11-21", null, cal).ok, false); // Saturday
  assert.deepEqual(sendingDay("2026-11-03", "VIC", cal), { ok: true }); // the Cup, a state holiday
  assert.deepEqual(sendingDay("2027-03-26", null, cal), { ok: false, reason: "Good Friday" });
  assert.equal(sendingDay("2026-12-21", null, cal).ok, false); // pause dates
  assert.equal(sendingDay("2027-01-12", null, cal).ok, true); // the day after the pause
  assert.equal(sendingDay("2031-03-04", null, { ...cal, weekends: true }).ok, true); // no year is "not covered" any more
});

test("the next sending day skips weekends, national holidays and the pause", () => {
  assert.equal(nextSendingDay("2026-11-20", null, cal), "2026-11-23"); // Friday to Monday
  assert.equal(nextSendingDay("2027-03-25", null, cal), "2027-03-30"); // over Easter
  assert.equal(nextSendingDay("2026-12-17", null, cal), "2027-01-12"); // over the pause
  assert.equal(nextSendingDay("2027-12-24", null, { pauseFrom: null, pauseTo: null }), "2027-12-29"); // over Christmas and its stand-ins
});

test("with Send on weekends, Saturday and Sunday count, and the big holidays and the pause still don't", () => {
  const wk: Calendar = { ...cal, weekends: true };
  assert.equal(sendingDay("2026-11-21", null, wk).ok, true); // Saturday
  assert.equal(sendingDay("2026-11-22", "QLD", wk).ok, true); // Sunday
  assert.equal(nextSendingDay("2026-11-20", null, wk), "2026-11-21"); // Friday to Saturday
  assert.deepEqual(sendingDay("2026-04-25", null, wk), { ok: false, reason: "Anzac Day" }); // a Saturday, still Anzac Day
  assert.equal(sendingDay("2026-12-19", null, wk).ok, false); // a Saturday in the pause
  assert.deepEqual(sendingDay("2027-12-25", null, { pauseFrom: null, pauseTo: null, weekends: true }), { ok: false, reason: "Christmas Day" });
  assert.equal(followUpDay("2026-11-14", null, wk), "2026-11-21"); // a Saturday first, a Saturday follow-up
});

test("the follow-up goes on day 7, or the next sending day after it", () => {
  assert.equal(followUpDay("2026-11-16", null, cal), "2026-11-23");
  assert.equal(followUpDay("2027-03-19", "QLD", cal), "2027-03-30"); // day 7 is Good Friday
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

const qpDecode = (s: string) =>
  Buffer.from(
    s.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
    "latin1",
  ).toString("utf8");

/** The two parts of a built message, still encoded, with their headers. */
function parts(raw: string): { headers: string; plain: string; html: string; plainHead: string; htmlHead: string } {
  const boundary = /boundary="([^"]+)"/.exec(raw)![1];
  const [headers, ...rest] = raw.split(`--${boundary}`);
  assert.equal(rest.length, 3, "two parts and the closing boundary");
  assert.equal(rest[2], "--\r\n");
  const split = (p: string) => {
    const i = p.indexOf("\r\n\r\n");
    return { head: p.slice(0, i), body: p.slice(i + 4).replace(/\r\n$/, "") };
  };
  const a = split(rest[0]);
  const b = split(rest[1]);
  return { headers, plain: a.body, html: b.body, plainHead: a.head, htmlHead: b.head };
}

test("the email: from Kyle Hartwell, CRLF, the words as plain text then bare HTML, threaded when it's a follow-up", () => {
  const raw = buildMessage({
    to: "sam@catten.com.au",
    subject: "your canopy page",
    body: "Hi Sam,\n\nOne line & <two>.\n\nKyle Hartwell",
    messageId: "<abc@hartwelldigital.com>",
    date: new Date("2026-11-23T22:31:00Z"),
  });
  const text = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(text, /^From: "Kyle Hartwell" <kyle@hartwelldigital\.com>\r\nTo: sam@catten\.com\.au\r\nSubject: your canopy page\r\n/);
  assert.match(text, /Date: Mon, 23 Nov 2026 22:31:00 \+0000\r\n/);
  assert.match(text, /Content-Type: multipart\/alternative; boundary="=_[0-9a-f]{32}"\r\n/);
  const p = parts(text);
  assert.match(p.plainHead, /Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable$/);
  assert.match(p.htmlHead, /Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable$/);
  assert.equal(qpDecode(p.plain), "Hi Sam,\r\n\r\nOne line & <two>.\r\n\r\nKyle Hartwell");
  assert.equal(
    qpDecode(p.html),
    '<div dir="ltr">\r\n<div>Hi Sam,</div>\r\n<div><br></div>\r\n<div>One line &amp; &lt;two&gt;.</div>\r\n<div><br></div>\r\n<div>Kyle Hartwell</div>\r\n</div>',
  );
  // Just the words: no links, images, styles or tracking, and Draper's name nowhere.
  assert.ok(!/<a |<img|style=|http|draper/i.test(text));

  const reply = Buffer.from(
    buildMessage({ to: "sam@catten.com.au", subject: "Re: your canopy page", body: "x", messageId: "<def@hartwelldigital.com>", inReplyTo: "<abc@hartwelldigital.com>" }),
    "base64url",
  ).toString("utf8");
  assert.match(reply, /In-Reply-To: <abc@hartwelldigital\.com>\r\nReferences: <abc@hartwelldigital\.com>\r\n/);
  // A header can't be split to smuggle in another.
  assert.equal(encodeHeader("a\r\nBcc: x@y.z"), "a Bcc: x@y.z");
  assert.equal(encodeHeader("café"), "=?UTF-8?B?Y2Fmw6k=?=");
});

test("both parts are quoted-printable, and in the HTML a paragraph is one element that reflows to the screen", () => {
  const para =
    "We were looking at 4WD fit-out shops around the Sunshine Coast on Tuesday and had a look at your site. On a phone, your canopy page took a little over six seconds to show anything on Google’s own speed test. 1 = 1 ";
  const body = `Hi Sam,\n\n${para}\n\nKyle Hartwell`;
  const raw = Buffer.from(
    buildMessage({ to: "sam@catten.com.au", subject: "your canopy page", body, messageId: "<abc@hartwelldigital.com>", boundary: "=_test" }),
    "base64url",
  ).toString("utf8");
  const p = parts(raw);
  for (const encoded of [p.plain, p.html]) {
    assert.ok(/^[\x20-\x7e\r\n]*$/.test(encoded), "plain ASCII on the wire");
    for (const line of encoded.split("\r\n")) {
      assert.ok(line.length <= 76, `over 76: ${line}`);
      assert.match(line, /^(?:[^=]|=[0-9A-F]{2})*=?$/, `a split escape: ${line}`);
    }
  }
  // Decoded, each is exactly what was written.
  assert.equal(qpDecode(p.plain), body.replace(/\n/g, "\r\n"));
  assert.ok(qpDecode(p.html).includes(`<div>${para.replace(/&/g, "&amp;")}</div>`));
  // The boundary can't occur inside quoted-printable ("=_" is never an escape).
  assert.ok(!p.plain.includes("=_") && !p.html.includes("=_"));

  assert.equal(quotedPrintable("a=b"), "a=3Db");
  assert.equal(quotedPrintable("ends "), "ends=20");
  assert.equal(quotedPrintable("it’s"), "it=E2=80=99s");
  const curly = quotedPrintable("’".repeat(40));
  for (const line of curly.split("\r\n")) assert.match(line, /^(?:=[0-9A-F]{2})*=?$/);
  assert.equal(qpDecode(curly), "’".repeat(40));
});

test("a queue fixed late still gets its full stop window", () => {
  const p = planDay({ date: "2026-11-23", windowStart: "09:30", windowEnd: "15:30", gapMin: 20, gapMax: 45, stopWindowMinutes: 90, fixedAt: "10:15", items: [{ id: "a" }], random: () => 0 });
  assert.equal(melbourneTime(p.times[0].at), "11:45");
});

