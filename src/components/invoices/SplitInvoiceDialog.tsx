"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Split, X } from "lucide-react";
import { splitInvoice } from "@/app/admin/invoices/actions";
import { planInstalments, toCents, toDollars, type Money } from "@/lib/instalments";
import { formatMoney } from "@/lib/invoices-shared";
import { businessDayOffset, businessToday } from "@/lib/business-time";
import type { Invoice } from "@/lib/types/database";
import { Button } from "@/components/ui/Button";

interface PartDraft {
  amount: string;
  due: string;
  send: string;
}

/**
 * The due date less the payment terms, which is when an invoice has to go out
 * to fall due on time.
 */
function sendDateFor(due: string, terms: number): string {
  const at = new Date(`${due}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - terms);
  return at.toISOString().slice(0, 10);
}

export function SplitInvoiceDialog({
  invoice,
  terms,
}: {
  invoice: Invoice;
  terms: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totalCents = toCents(invoice.total);
  const gstCents = toCents(invoice.gst);
  const parent: Money = {
    exCents: totalCents - gstCents,
    gstCents,
    totalCents,
  };

  function freshParts(n: number): PartDraft[] {
    const base = Math.floor(totalCents / n);
    return Array.from({ length: n }, (_, i) => {
      const cents = i === n - 1 ? totalCents - base * (n - 1) : base;
      // The first part is normally the one going out today; the rest fall due a
      // fortnight apart until told otherwise.
      const due = i === 0 ? businessToday() : businessDayOffset(14 * i);
      return {
        amount: toDollars(cents).toFixed(2),
        due,
        // Nothing is scheduled for the first part, because it is usually sent
        // by hand on the day the split is agreed.
        send: i === 0 ? "" : sendDateFor(due, terms),
      };
    });
  }

  const [parts, setParts] = useState<PartDraft[]>(() => freshParts(2));

  const plan = planInstalments(
    parent,
    parts.map((p) => toCents(p.amount || 0)),
  );
  const datesMissing = parts.some((p) => !p.due);
  const canSplit = !plan.problem && !datesMissing && !pending;

  function setPart(i: number, patch: Partial<PartDraft>) {
    setParts((prev) =>
      prev.map((p, j) => {
        if (j !== i) return p;
        const next = { ...p, ...patch };
        // Moving a due date moves its send date with it, unless that part is
        // not scheduled at all.
        if (patch.due && p.send) next.send = sendDateFor(patch.due, terms);
        return next;
      }),
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await splitInvoice(
          invoice.id,
          parts.map((p) => ({
            amount: Number(p.amount),
            due_date: p.due,
            send_date: p.send || null,
          })),
          note,
        );
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not split the invoice.");
      }
    });
  }

  const field =
    "rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2 py-1.5 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Split size={14} /> Split
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="relative max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
            <div className="flex items-center justify-between border-b border-pulse-border px-4 py-3">
              <p className="text-sm font-medium text-pulse-text">
                Split {invoice.invoice_number} into instalments
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <p className="text-xs text-pulse-text-dim">
                {formatMoney(Number(invoice.total))} including{" "}
                {formatMoney(Number(invoice.gst))} GST. Each instalment becomes
                its own tax invoice, numbered {invoice.invoice_number}-1 and so
                on. This invoice stays on the record and stops being chased.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setParts(freshParts(n))}
                    className={`rounded-[var(--radius-input)] border px-2.5 py-1.5 text-xs ${
                      parts.length === n
                        ? "border-pulse-gold/40 bg-pulse-gold/10 text-pulse-gold"
                        : "border-dashed border-pulse-border text-pulse-text-dim hover:text-pulse-text"
                    }`}
                  >
                    {n === 2 ? "Split 50/50" : `${n} equal parts`}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {parts.map((p, i) => (
                  <div
                    key={i}
                    className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/30 p-3"
                  >
                    <p className="mono-label mb-2">
                      Part {i + 1} of {parts.length}
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="mono-label">Amount inc GST</span>
                        <input
                          type="number"
                          step="any"
                          value={p.amount}
                          onChange={(e) => setPart(i, { amount: e.target.value })}
                          className={`${field} w-28 text-right`}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="mono-label">Due</span>
                        <input
                          type="date"
                          value={p.due}
                          onChange={(e) => setPart(i, { due: e.target.value })}
                          className={field}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="mono-label">Send on</span>
                        <input
                          type="date"
                          value={p.send}
                          onChange={(e) => setPart(i, { send: e.target.value })}
                          className={field}
                        />
                      </label>
                    </div>
                    {plan.parts[i] && (
                      <p className="data-mono mt-2 text-[11px] text-pulse-text-mute">
                        {formatMoney(toDollars(plan.parts[i].exCents))} ex GST
                        plus {formatMoney(toDollars(plan.parts[i].gstCents))} GST
                      </p>
                    )}
                    {!p.send && (
                      <p className="mt-1 text-[11px] text-pulse-text-mute">
                        Not scheduled. Created as a draft for you to send when
                        you are ready.
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <label className="flex flex-col gap-1">
                <span className="mono-label">Why it was split</span>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Agreed by text on 2 October: half now, half on the 16th."
                  className={`${field} w-full resize-y`}
                />
                <span className="text-[11px] text-pulse-text-mute">
                  Kept on the record, because an agreement made by message has
                  no other home.
                </span>
              </label>

              {plan.problem && (
                <p className="rounded-[var(--radius-input)] border border-pulse-danger/30 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                  {plan.problem}
                </p>
              )}
              {datesMissing && !plan.problem && (
                <p className="text-xs text-pulse-text-mute">
                  Every instalment needs a due date.
                </p>
              )}
              {error && (
                <p className="rounded-[var(--radius-input)] border border-pulse-danger/30 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-pulse-border pt-3">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={submit} disabled={!canSplit}>
                  {pending
                    ? "Splitting..."
                    : `Create ${parts.length} instalments`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
