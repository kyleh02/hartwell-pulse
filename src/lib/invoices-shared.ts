// Client-safe invoice helpers (GST maths, money formatting). No server imports.
import type { GstMode, Invoice, InvoiceLineItem, Client } from "@/lib/types/database";

export interface LineDraft {
  id: string;
  description: string;
  quantity: number;
  unit_amount: number;
}

export interface InvoiceTotals {
  subtotal: number;
  gst: number;
  total: number;
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function lineAmount(l: { quantity: number; unit_amount: number }): number {
  return round((l.quantity || 0) * (l.unit_amount || 0));
}

export function computeTotals(
  lines: { quantity: number; unit_amount: number }[],
  gstMode: GstMode,
): InvoiceTotals {
  const sum = lines.reduce((s, l) => s + lineAmount(l), 0);
  if (gstMode === "add") {
    const gst = round(sum * 0.1);
    return { subtotal: round(sum), gst, total: round(sum + gst) };
  }
  if (gstMode === "inclusive") {
    const gst = round(sum - sum / 1.1);
    return { subtotal: round(sum - gst), gst, total: round(sum) };
  }
  return { subtotal: round(sum), gst: 0, total: round(sum) };
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
