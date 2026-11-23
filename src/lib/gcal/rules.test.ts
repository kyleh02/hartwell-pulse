import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, fingerprint, invoiceItem, leadItem, melbourneDate, planSync, workItem } from "./rules.ts";

const O = "https://portal.hartwelldigital.com";

test("portal items as Google events", () => {
  const inv = invoiceItem({ id: "i1", invoice_number: "INV-0038", due_date: "2026-11-20" }, "SecureSupply", "$1,210.00", O);
  assert.equal(inv.title, "Invoice INV-0038 due: SecureSupply, $1,210.00");
  assert.deepEqual(inv.start, { date: "2026-11-20" });
  assert.deepEqual(inv.end, { date: "2026-11-21" }); // Google's all-day end is the next day
  assert.match(inv.description, /\/admin\/invoices\/i1$/);

  assert.equal(leadItem({ id: "l1", name: "Sarah Selwood", business: "Selwood Physio", follow_up_on: "2026-11-24", next_action: null }, O).title, "Follow up: Sarah Selwood (Selwood Physio)");
  assert.equal(leadItem({ id: "l2", name: null, business: "Selwood Physio", follow_up_on: "2026-11-24", next_action: null }, O).title, "Follow up: Selwood Physio");

  // A timed work item keeps its time, half an hour long; an untimed one is all day in Melbourne.
  const timed = workItem({ id: "w1", title: "Call Deepayan", detail: null, due_at: "2026-11-24T00:00:00Z", has_time: true }, O);
  assert.deepEqual(timed.start, { dateTime: "2026-11-24T00:00:00.000Z", timeZone: "Australia/Melbourne" });
  assert.deepEqual(timed.end, { dateTime: "2026-11-24T00:30:00.000Z", timeZone: "Australia/Melbourne" });
  const day = workItem({ id: "w2", title: "Send report", detail: "Q4", due_at: "2026-11-23T14:00:00Z", has_time: false }, O);
  assert.deepEqual(day.start, { date: "2026-11-24" }); // 1am on the 24th in Melbourne
});

test("a sync inserts the new, updates the changed, removes the gone", () => {
  const a = invoiceItem({ id: "a", invoice_number: "INV-1", due_date: "2026-11-20" }, "A", "$1.00", O);
  const b = invoiceItem({ id: "b", invoice_number: "INV-2", due_date: "2026-11-21" }, "B", "$2.00", O);
  const bMoved = { ...b, start: { date: "2026-11-28" }, end: { date: "2026-11-29" } };
  const plan = planSync(
    [a, bMoved],
    [
      { source_kind: "invoice", source_id: "b", event_id: "eb", fingerprint: fingerprint(b) },
      { source_kind: "invoice", source_id: "paid", event_id: "ep", fingerprint: "x" },
    ],
  );
  assert.deepEqual(plan.insert.map((i) => i.id), ["a"]);
  assert.deepEqual(plan.update.map((u) => [u.item.id, u.eventId]), [["b", "eb"]]);
  assert.deepEqual(plan.remove.map((r) => r.source_id), ["paid"]);
  // Nothing changed: nothing to do.
  const still = planSync([a], [{ source_kind: "invoice", source_id: "a", event_id: "ea", fingerprint: fingerprint(a) }]);
  assert.deepEqual([still.insert.length, still.update.length, still.remove.length], [0, 0, 0]);
});

test("dates", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(melbourneDate("2026-11-23T13:30:00Z"), "2026-11-24");
});
