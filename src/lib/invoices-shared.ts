// Client-safe invoice helpers (GST maths, money formatting). No server imports.
import type { GstMode, Invoice, InvoiceLineItem, Client } from "@/lib/types/database";

// Default body for invoice emails, used until a custom one is set in Settings or
// on the invoice itself. Placeholders in {braces} are filled in when sent.
export const DEFAULT_INVOICE_EMAIL =
  "Hi {client},\n\nA new invoice ({invoice}) for {amount} is ready in your portal, due {due date}. You can view it any time using the button below.\n\nThanks,\nKyle";

export interface LineDraft {
  id: string;
  title: string;
  description: string;
  quantity: number;
  unit_amount: number;
}

export interface InvoiceTotals {
  /** Sum of the charge (positive) lines, before discounts. */
  subtotal: number;
  /** Total of the discount (negative) lines, as a positive number. */
  discount: number;
  gst: number;
  total: number;
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function lineAmount(l: { quantity: number; unit_amount: number }): number {
  return round((l.quantity || 0) * (l.unit_amount || 0));
}

/**
 * Compute the invoice totals. Discounts are entered as negative line items, so we
 * split the lines: positive amounts make up the subtotal of charges, negative
 * amounts sum into the discount. GST is worked out on the net, and the discount is
 * capped at the subtotal so a total can never go negative. The document shows the
 * discount lines in the table AND a netted Discount row in the totals.
 */
export function computeTotals(
  lines: { quantity: number; unit_amount: number }[],
  gstMode: GstMode,
): InvoiceTotals {
  let charges = 0;
  let discounts = 0;
  for (const l of lines) {
    const amt = lineAmount(l);
    if (amt < 0) discounts += -amt;
    else charges += amt;
  }
  const subtotal = round(charges);
  const disc = round(Math.min(discounts, charges));
  const net = round(subtotal - disc);
  if (gstMode === "add") {
    const gst = round(net * 0.1);
    return { subtotal, discount: disc, gst, total: round(net + gst) };
  }
  if (gstMode === "inclusive") {
    const gst = round(net - net / 1.1);
    return { subtotal, discount: disc, gst, total: net };
  }
  return { subtotal, discount: disc, gst: 0, total: net };
}

export function formatMoney(n: number): string {
  return (n ?? 0).toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
  });
}

export function gstLabel(mode: GstMode): string {
  if (mode === "add") return "GST (10%)";
  if (mode === "inclusive") return "Includes GST";
  return "No GST";
}

export interface InvoiceBundle {
  invoice: Invoice;
  client: Client;
  lines: InvoiceLineItem[];
}
