import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoPauseReason,
  classify,
  htmlToText,
  parseMessage,
  theirWords,
  type GmailMessage,
  type GmailPart,
  type SentFirst,
} from "./replies-rules.ts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const OPT_OUT_A = "If this isn't relevant, just reply and say so, and we won't email again.";
const OPT_OUT_B = 'If it\'s not for you, one word back is a real help: "sorted" if someone already looks after your ads, "later" if the timing\'s off, or "no thanks" and we won\'t email again.';
const OURS = [OPT_OUT_A, OPT_OUT_B, "Hartwell Digital, ABN 44 286 503 049"];

function msg(o: { from?: string; subject?: string; text?: string; html?: string; headers?: Record<string, string>; parts?: GmailPart[]; contentType?: string }): GmailMessage {
  const headers = [
    { name: "From", value: o.from ?? "Sam Catten <sam@catten.com.au>" },
    { name: "Subject", value: o.subject ?? "Re: your canopy page" },
    { name: "In-Reply-To", value: "<abc@hartwelldigital.com>" },
    ...(o.contentType ? [{ name: "Content-Type", value: o.contentType }] : []),
    ...Object.entries(o.headers ?? {}).map(([name, value]) => ({ name, value })),
  ];
  const parts: GmailPart[] = o.parts ?? [
    ...(o.text !== undefined ? [{ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=UTF-8" }], body: { data: b64(o.text) } }] : []),
    ...(o.html !== undefined ? [{ mimeType: "text/html", headers: [{ name: "Content-Type", value: "text/html; charset=UTF-8" }], body: { data: b64(o.html) } }] : []),
  ];
  return { id: "m1", threadId: "t1", internalDate: "1795136000000", payload: { mimeType: "multipart/alternative", headers, parts } };
}

const kind = (m: GmailMessage) => classify(parseMessage(m), OURS).kind;

test("a message is read: sender, subject, text, and the Message-IDs it points at", () => {
  const p = parseMessage(msg({ text: "Sounds good, send it over.\n\nSam" }));
  assert.equal(p.fromEmail, "sam@catten.com.au");
  assert.equal(p.subject, "Re: your canopy page");
  assert.equal(p.text, "Sounds good, send it over.\n\nSam");
  assert.deepEqual(p.messageIds, ["<abc@hartwelldigital.com>"]);
  assert.equal(p.receivedAt, new Date(1795136000000).toISOString());
});

test("their words stop where the quoted original starts, Gmail or Outlook", () => {
  const gmail = "Yes please, write it up.\n\nOn Fri, 20 Nov 2026 at 4:31 pm, Kyle Hartwell <kyle@hartwelldigital.com>\nwrote:\n> Hi Sam,\n> We were looking";
  assert.equal(theirWords(gmail), "Yes please, write it up.");
  const outlook = "Sure, happy to look.\r\n\r\n________________________________\r\nFrom: Kyle Hartwell <kyle@hartwelldigital.com>\r\nSent: Friday, 20 November 2026 4:31 PM\r\nTo: Sam";
  assert.equal(theirWords(outlook), "Sure, happy to look.");
  const outlook2 = "Go for it\n\nFrom: Kyle Hartwell\nDate: Friday, 20 November 2026\nSubject: your canopy page";
  assert.equal(theirWords(outlook2), "Go for it");
  assert.equal(theirWords("Ok\n\nSent from my iPhone\n\n> quoted"), "Ok");
});

test("a real reply that quotes our opt-out line B isn't an opt-out", () => {
  const text = `Who are you and how did you find us?\n\n${OPT_OUT_B}\n\nKyle Hartwell\nHartwell Digital, ABN 44 286 503 049`;
  assert.equal(kind(msg({ text })), "reply");
  // Even quoted badly, without "On ... wrote:" and with the line re-wrapped.
  const wrapped = `What does it cost?\n\nIf it's not for you, one word back is a real help: "sorted" if someone\nalready looks after your ads, "later" if the timing's off, or "no thanks"\nand we won't email again.`;
  assert.equal(kind(msg({ text: wrapped })), "reply");
});

test("opt-outs, in their own words, are caught", () => {
  for (const t of ["No thanks", "no thank you, we're right", "Please remove me from your list", "STOP", "Nope.", "nah", "Not interested mate", "Unsubscribe", "Don't email us again", "Take me off your list please", "this is spam"]) {
    assert.equal(kind(msg({ text: t })), "opt_out", t);
  }
  // ...above a quoted original, too.
  assert.equal(kind(msg({ text: "Not interested.\n\nOn Fri, 20 Nov 2026, Kyle Hartwell wrote:\n> Hi" })), "opt_out");
});

test("a tagline or a legal footer isn't an opt-out", () => {
  const sig = "Sounds interesting, send it through.\n\nSam\nCatten 4WD, your one-stop canopy shop";
  assert.equal(kind(msg({ text: sig })), "reply");
  const footer =
    "Yes please.\nSam\nThis email and any attachments are confidential. If you are not the intended recipient, please notify the sender and remove it from your system.";
  assert.equal(kind(msg({ text: footer })), "reply");
  // A real "remove me" above the footer still counts, blank line or not.
  const both = "Please remove me.\nSam\nIf you are not the intended recipient, please delete this email.";
  assert.equal(kind(msg({ text: both })), "opt_out");
});

test("bounces, delays and out-of-office replies", () => {
  const bounce = msg({
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    subject: "Delivery Status Notification (Failure)",
    contentType: 'multipart/report; report-type=delivery-status; boundary="x"',
    parts: [
      { mimeType: "text/plain", body: { data: b64("Address not found. Your message wasn't delivered to sam@catten.com.au") } },
      { mimeType: "message/delivery-status", body: { data: b64("Action: failed\nStatus: 5.1.1") } },
      { mimeType: "text/rfc822-headers", body: { data: b64("Message-ID: <first-1@hartwelldigital.com>") } },
    ],
  });
  assert.equal(kind(bounce), "bounce");
  assert.ok(parseMessage(bounce).messageIds.includes("<first-1@hartwelldigital.com>"));
  const delay = msg({ from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Delay)", text: "Gmail will retry for 46 more hours." });
  assert.equal(kind(delay), "delay");
  assert.equal(kind(msg({ subject: "Automatic reply: your canopy page", text: "I'm away until Monday." })), "auto_reply");
  assert.equal(kind(msg({ headers: { "Auto-Submitted": "auto-replied" }, text: "Thanks, we'll be in touch. Unsubscribe here." })), "auto_reply");
  // Without the headers or subject, words alone don't make it automatic: a person may be away and still answering.
  assert.equal(kind(msg({ text: "I'll be back next week to look at it properly. Send it over." })), "reply");
  assert.equal(kind(msg({ text: "I am currently out of the office and will return on 1 December." })), "reply");
  // A person who's away AND says stop is an opt-out.
  assert.equal(kind(msg({ text: "Out of office this week, but no thanks anyway." })), "opt_out");
});

test("an HTML-only reply is read without Gmail's quoted block", () => {
  const html = '<div dir="ltr">Keen to hear more &amp; see the list.<br>Sam</div><div class="gmail_quote"><div>On Fri... wrote:</div><blockquote>no thanks</blockquote></div>';
  assert.equal(htmlToText(html), "Keen to hear more & see the list.\nSam");
  assert.equal(kind(msg({ html })), "reply");
});

const f = (o: Partial<SentFirst>): SentFirst => ({ bounced: false, noThanks: false, interested: false, ...o });

test("auto-pause: three bounces or three no-thanks in the last 40, or 100 with nobody interested", () => {
  assert.equal(autoPauseReason([]), null);
  assert.equal(autoPauseReason([f({ bounced: true }), f({ bounced: true }), ...Array(38).fill(f({}))]), null); // 2 in 40 is 5%: not over
  assert.match(autoPauseReason([f({ bounced: true }), f({ bounced: true }), f({ bounced: true })]) ?? "", /3 bounces/);
  assert.match(autoPauseReason([f({ noThanks: true }), f({ noThanks: true }), f({}), f({ noThanks: true })]) ?? "", /3 "no thanks"/);
  // Old bounces outside the last 40 don't count.
  assert.equal(autoPauseReason([...Array(40).fill(f({ interested: true })), f({ bounced: true }), f({ bounced: true }), f({ bounced: true })]), null);
  assert.equal(autoPauseReason(Array(99).fill(f({}))), null);
  assert.match(autoPauseReason(Array(100).fill(f({}))) ?? "", /100 first emails/);
  assert.equal(autoPauseReason([...Array(99).fill(f({})), f({ interested: true })]), null);
});
