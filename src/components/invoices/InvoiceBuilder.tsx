"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Send } from "lucide-react";
import type {
  BusinessSettings,
  GstMode,
  InvoiceLineItem,
  InvoiceStatus,
  PricingItem,
} from "@/lib/types/database";
import type { InvoiceBundle, LineDraft } from "@/lib/invoices-shared";
import {
  computeTotals,
  lineAmount,
  formatMoney,
  DEFAULT_INVOICE_EMAIL,
} from "@/lib/invoices-shared";
import {
  saveInvoice,
  sendInvoice,
  setInvoiceStatus,
  deleteInvoice,
} from "@/app/admin/invoices/actions";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import { PrintButton } from "@/components/invoices/PrintButton";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const STATUS_TONE: Record<InvoiceStatus, "neutral" | "gold" | "success" | "danger"> = {
  draft: "neutral",
  sent: "gold",
  paid: "success",
  void: "danger",
};

export function InvoiceBuilder({
  bundle,
  pricingItems,
  business,
}: {
  bundle: InvoiceBundle;
  pricingItems: PricingItem[];
  business: BusinessSettings | null;
}) {
  const { invoice } = bundle;
  const [lines, setLines] = useState<LineDraft[]>(() =>
    bundle.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: Number(l.quantity),
      unit_amount: Number(l.unit_amount),
    })),
  );
  const [issueDate, setIssueDate] = useState(invoice.issue_date.slice(0, 10));
  const [dueDate, setDueDate] = useState(invoice.due_date.slice(0, 10));
  const [gstMode, setGstMode] = useState<GstMode>(invoice.gst_mode);
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [emailMessage, setEmailMessage] = useState(
    () =>
      invoice.email_message ??
      business?.invoice_email_message ??
      DEFAULT_INVOICE_EMAIL,
  );
  const [recurringActive, setRecurringActive] = useState(
    invoice.recurring_active ?? false,
  );
  const [anchorDay, setAnchorDay] = useState(invoice.recurring_anchor_day ?? 1);
  const [discount, setDiscount] = useState(Number(invoice.discount ?? 0));
  const [discountLabel, setDiscountLabel] = useState(invoice.discount_label ?? "");
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status);
  const [saved, setSaved] = useState(true);
  const [pending, startTransition] = useTransition();

  const editable = status === "draft";
  const totals = computeTotals(lines, gstMode, discount);

  function touch() {
    setSaved(false);
  }
  function addBlank() {
    setLines((p) => [...p, { id: newId(), description: "", quantity: 1, unit_amount: 0 }]);
    touch();
  }
  function addFromCatalogue(itemId: string) {
    const it = pricingItems.find((p) => p.id === itemId);
    if (!it) return;
    setLines((p) => [
      ...p,
      {
        id: newId(),
        description: it.tier ? `${it.name} — ${it.tier}` : it.name,
        quantity: 1,
        unit_amount: Number(it.default_amount),
      },
    ]);
    touch();
  }
  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    touch();
  }
  function removeLine(id: string) {
    setLines((p) => p.filter((l) => l.id !== id));
    touch();
  }

  function buildInput() {
    return {
      issue_date: issueDate,
      due_date: dueDate,
      gst_mode: gstMode,
      discount: Number(discount) || 0,
      discount_label: discountLabel,
      notes,
      email_message: emailMessage,
      recurring_active: recurringActive,
      recurring_anchor_day: anchorDay,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity) || 0,
        unit_amount: Number(l.unit_amount) || 0,
      })),
    };
  }
  function save() {
    startTransition(async () => {
      await saveInvoice(invoice.id, buildInput());
      setSaved(true);
    });
  }
  function send() {
    if (!window.confirm("Send this invoice to the client now? They'll get an email and a notification.")) return;
    startTransition(async () => {
      await saveInvoice(invoice.id, buildInput());
      await sendInvoice(invoice.id);
      setStatus("sent");
      setSaved(true);
    });
  }
  function mark(s: InvoiceStatus) {
    startTransition(async () => {
      await setInvoiceStatus(invoice.id, s);
      setStatus(s);
    });
  }
  function del() {
    if (
      !window.confirm(
        "Delete this draft invoice? This permanently removes it and can't be undone.",
      )
    )
      return;
    startTransition(async () => {
      await deleteInvoice(invoice.id);
    });
  }

  // live preview built from the current edits
  const previewBundle: InvoiceBundle = {
    invoice: {
      ...invoice,
      issue_date: issueDate,
      due_date: dueDate,
      gst_mode: gstMode,
      notes: notes || null,
      discount: totals.discount,
      discount_label: discountLabel.trim() || null,
      subtotal: totals.subtotal,
      gst: totals.gst,
      total: totals.total,
      status,
    },
    client: bundle.client,
    lines: lines.map((l, i) => ({
      id: l.id,
      invoice_id: invoice.id,
      client_id: bundle.client.id,
      description: l.description || "—",
      quantity: Number(l.quantity) || 0,
      unit_amount: Number(l.unit_amount) || 0,
      amount: lineAmount(l),
      position: i,
    })) as InvoiceLineItem[],
  };

  const fieldCls =
    "rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2 py-1.5 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none disabled:opacity-60";

  return (
    <div>
      <Link
        href="/admin/invoices"
        className="no-print mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ArrowLeft size={15} strokeWidth={1.75} /> All invoices
      </Link>

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
        <div>
          <p className="data-mono text-sm text-pulse-text">
            {invoice.invoice_number} · {bundle.client.business_name}
          </p>
          <p className="text-xs text-pulse-text-mute">
            {formatMoney(totals.total)} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[status]}>{status}</Badge>
          {editable ? (
            <>
              <Button variant="danger" size="sm" onClick={del} disabled={pending}>
                <Trash2 size={14} /> Delete
              </Button>
              <span className="data-mono text-[11px] text-pulse-text-mute">
                {saved ? "saved" : "unsaved"}
              </span>
              <Button variant="secondary" size="sm" onClick={save} disabled={pending}>
                Save
              </Button>
              {recurringActive ? (
                <span className="data-mono text-[11px] text-pulse-gold">
                  auto-sends monthly
                </span>
              ) : (
                <Button size="sm" onClick={send} disabled={pending || lines.length === 0}>
                  <Send size={14} /> Send
                </Button>
              )}
            </>
          ) : status === "sent" ? (
            <>
              <Button size="sm" onClick={() => mark("paid")} disabled={pending}>
                Mark paid
              </Button>
              <Button variant="ghost" size="sm" onClick={() => mark("void")} disabled={pending}>
                Void
              </Button>
            </>
          ) : status === "paid" ? (
            <Button variant="ghost" size="sm" onClick={() => mark("sent")} disabled={pending}>
              Reopen
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* editor */}
        <div className="no-print space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="mono-label">Issue date</span>
              <input
                type="date"
                value={issueDate}
                disabled={!editable}
                onChange={(e) => {
                  setIssueDate(e.target.value);
                  touch();
                }}
                className={fieldCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="mono-label">Due date</span>
              <input
                type="date"
                value={dueDate}
                disabled={!editable}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  touch();
                }}
                className={fieldCls}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="mono-label">GST</span>
            <select
              value={gstMode}
              disabled={!editable}
              onChange={(e) => {
                setGstMode(e.target.value as GstMode);
                touch();
              }}
              className={fieldCls}
            >
              <option value="add">Add 10% GST (Tax Invoice)</option>
              <option value="inclusive">Prices include GST</option>
              <option value="none">No GST</option>
            </select>
          </label>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm text-pulse-text-dim">
              <input
                type="checkbox"
                checked={recurringActive}
                disabled={!editable}
                onChange={(e) => {
                  setRecurringActive(e.target.checked);
                  touch();
                }}
              />
              Recurring monthly — auto-generate and send each month
            </label>
            {recurringActive && (
              <label className="flex items-center gap-2 pl-6 text-xs text-pulse-text-mute">
                Bill on day
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={anchorDay}
                  disabled={!editable}
                  onChange={(e) => {
                    setAnchorDay(Number(e.target.value));
                    touch();
                  }}
                  className={`${fieldCls} w-16 text-right`}
                />
                of each month (auto-sends until you switch this off)
              </label>
            )}
          </div>

          <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-3">
            <p className="mono-label mb-2">Line items</p>
            <div className="space-y-2">
              {lines.map((l) => (
                <div
                  key={l.id}
                  className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/30 p-2"
                >
                  <textarea
                    value={l.description}
                    disabled={!editable}
                    onChange={(e) => updateLine(l.id, { description: e.target.value })}
                    placeholder="Describe the work — what they're getting and why it's worth it. Be specific; this shows on the invoice."
                    rows={2}
                    className={`${fieldCls} w-full resize-y`}
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <span className="mono-label">Qty</span>
                    <input
                      type="number"
                      value={l.quantity}
                      disabled={!editable}
                      onChange={(e) => updateLine(l.id, { quantity: Number(e.target.value) })}
                      className={`${fieldCls} w-14 text-right`}
                    />
                    <span className="mono-label">Unit</span>
                    <input
                      type="number"
                      value={l.unit_amount}
                      disabled={!editable}
                      onChange={(e) =>
                        updateLine(l.id, { unit_amount: Number(e.target.value) })
                      }
                      className={`${fieldCls} w-24 text-right`}
                    />
                    <span className="data-mono w-24 text-right text-sm text-pulse-text">
                      {formatMoney(lineAmount(l))}
                    </span>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => removeLine(l.id)}
                        aria-label="Remove line"
                        className="text-pulse-text-mute hover:text-pulse-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {editable && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addBlank}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-2.5 py-1.5 text-xs text-pulse-text-dim hover:text-pulse-text"
                >
                  <Plus size={13} /> Line
                </button>
                {pricingItems.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addFromCatalogue(e.target.value);
                      e.target.value = "";
                    }}
                    className={`${fieldCls} text-xs`}
                  >
                    <option value="">Add from catalogue…</option>
                    {pricingItems
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.tier ? `${p.name} — ${p.tier}` : p.name} (
                          {formatMoney(Number(p.default_amount))})
                        </option>
                      ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <label className="flex flex-col gap-1">
              <span className="mono-label">Discount label (optional)</span>
              <input
                value={discountLabel}
                disabled={!editable}
                onChange={(e) => {
                  setDiscountLabel(e.target.value);
                  touch();
                }}
                placeholder="Website build discount"
                className={fieldCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="mono-label">Discount ($)</span>
              <input
                type="number"
                min={0}
                value={discount}
                disabled={!editable}
                onChange={(e) => {
                  setDiscount(Number(e.target.value));
                  touch();
                }}
                className={`${fieldCls} text-right`}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="mono-label">Notes</span>
            <textarea
              value={notes}
              disabled={!editable}
              onChange={(e) => {
                setNotes(e.target.value);
                touch();
              }}
              rows={3}
              placeholder="Anything the client should know (optional)."
              className={fieldCls}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="mono-label">Email message to client</span>
            <textarea
              value={emailMessage}
              disabled={!editable}
              onChange={(e) => {
                setEmailMessage(e.target.value);
                touch();
              }}
              rows={6}
              className={fieldCls}
            />
            <span className="text-[11px] text-pulse-text-mute">
              What the client receives in the invoice email. {"{client}"},{" "}
              {"{invoice}"}, {"{amount}"} and {"{due date}"} fill in automatically.
            </span>
          </label>
        </div>

        {/* live preview */}
        <div>
          <div className="no-print mb-2 flex items-center justify-between">
            <p className="mono-label">Preview</p>
            <PrintButton />
          </div>
          <InvoiceDocument bundle={previewBundle} business={business} />
        </div>
      </div>
    </div>
  );
}
