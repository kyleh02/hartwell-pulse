// Client-safe invoice helpers (GST maths, money formatting). No server imports.
import type { GstMode, Invoice, InvoiceLineItem, Client } from "@/lib/types/database";

// Default body for invoice emails, used until a custom one is set in Settings or
// on the invoice itself. Placeholders in {braces} are filled in when sent.
export const DEFAULT_INVOICE_EMAIL =
  "Hi {client},\n\nA new invoice ({invoice}) for {amount} is ready in your portal, due {due date}. You can view it any time using the button below.\n\nThanks,\nKyle";

export interface LineDraft {
  id: string;
  description: string;
  quantity: number;
  unit_amount: number;
}

export interface InvoiceTotals {
  /** Gross sum of the line items, before any discount. */
  subtotal: number;
  /** Discount applied (never more than the subtotal). */
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
 * Compute the invoice totals. A discount (fixed dollars) comes off the line sum
 * before GST is worked out, and is capped at the subtotal so a total can never go
 * negative. `subtotal` is always the gross line sum; the document renders the
 * discount as its own row.
 */
export function computeTotals(
  lines: { quantity: number; unit_amount: number }[],
  gstMode: GstMode,
  discount = 0,
): InvoiceTotals {
  const gross = round(lines.reduce((s, l) => s + lineAmount(l), 0));
  const disc = round(Math.min(Math.max(discount || 0, 0), gross));
  const net = round(gross - disc);
  if (gstMode === "add") {
    const gst = round(net * 0.1);
    return { subtotal: gross, discount: disc, gst, total: round(net + gst) };
  }
  if (gstMode === "inclusive") {
    const gst = round(net - net / 1.1);
    return { subtotal: gross, discount: disc, gst, total: net };
  }
  return { subtotal: gross, discount: disc, gst: 0, total: net };
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
