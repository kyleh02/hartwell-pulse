import { test } from "node:test";
import assert from "node:assert/strict";
import { e2eChecklist, type E2EMessage } from "./e2e.ts";
import { undeliverableAddress } from "./normalise.ts";

const T = "2026-11-23T00:00:00Z";
const msg = (o: Partial<E2EMessage> & Pick<E2EMessage, "prospect_id" | "kind">): E2EMessage => ({
  status: "queued",
  confirmed_at: T,
  sent_at: null,
  test_mode: null,
  subject: "your canopies page",
  body: "Hi there,\n\nIf this isn't relevant, just reply and say so, and we won't email again.",
  gmail_thread_id: null,
  ...o,
});

test("nothing ticks before anything has run", () => {
  const c = e2eChecklist([], [], []);
  assert.equal(c.length, 6);
  assert.ok(c.every((x) => x.by === null));
});

test("each check ticks from the business that proved it", () => {
  const prospects = [
    { id: "a", name: "Suncoast Caravan Service" },
    { id: "b", name: "Hartwell Digital" },
  ];
  const messages = [
    msg({ prospect_id: "a", kind: "first", status: "sent", sent_at: T, test_mode: true, gmail_thread_id: "t1" }),
    msg({ prospect_id: "a", kind: "follow_up", status: "sent", sent_at: T, test_mode: true, gmail_thread_id: "t1" }),
    msg({ prospect_id: "b", kind: "first", status: "sent", sent_at: T, test_mode: true, gmail_thread_id: "t2" }),
    msg({ prospect_id: "b", kind: "follow_up", status: "cancelled" }),
  ];
  const replies = [
    { prospect_id: "a", kind: "reply", label: null },
    { prospect_id: "b", kind: "opt_out", label: "no_thanks" },
  ];
  const by = Object.fromEntries(e2eChecklist(prospects, messages, replies).map((c) => [c.key, c.by]));
  assert.deepEqual(by, {
    confirmed: "Suncoast Caravan Service",
    first_sent: "Suncoast Caravan Service",
    threaded: "Suncoast Caravan Service",
    opt_out_line: "Suncoast Caravan Service",
    reply_seen: "Suncoast Caravan Service",
    opt_out_stops: "Hartwell Digital",
  });
});

test("the test pair, a real send, a different thread or a wrong subject don't count", () => {
  const prospects = [{ id: "p", name: "Test pair" }];
  // A test pair never went through the re-check.
  const pair = [msg({ prospect_id: "p", kind: "first", status: "sent", sent_at: T, test_mode: true, confirmed_at: null })];
  assert.ok(e2eChecklist(prospects, pair, [{ prospect_id: "p", kind: "reply", label: null }]).every((c) => c.by === null));
  const odd = [
    msg({ prospect_id: "p", kind: "first", status: "sent", sent_at: T, test_mode: false, gmail_thread_id: "t1" }),
    msg({ prospect_id: "p", kind: "follow_up", status: "sent", sent_at: T, test_mode: true, gmail_thread_id: "t9" }),
  ];
  const c = Object.fromEntries(e2eChecklist(prospects, odd, []).map((x) => [x.key, x.by]));
  assert.equal(c.first_sent, null); // reached a business, not the test inbox
  assert.equal(c.threaded, null);
});

test("an address that can never receive mail is caught", () => {
  for (const e of ["workshop@sample-workshop.invalid", "a@b.test", "x@shop.example", "x@localhost", "x@example.com", "x@mail.example.org"]) {
    assert.equal(undeliverableAddress(e), true, e);
  }
  for (const e of ["sam@catten.com.au", "info@theuteshop.com.au", "kyle@hartwelldigital.com", "bob@examples.com.au"]) {
    assert.equal(undeliverableAddress(e), false, e);
  }
  assert.equal(undeliverableAddress(""), true);
});
