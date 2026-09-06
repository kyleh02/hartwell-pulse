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
  /** Null when the invoice is not phased. See groupByPhase. */
  phase_position: number | null;
  phase_title: string;
  phase_note: string;
}

/** Anything the phase grouper can read a phase off. */
export interface PhaseFields {
  phase_position?: number | null;
  phase_title?: string | null;
  phase_note?: string | null;
}

export interface PhaseGroup<T> {
  /** Stable key for rendering. "none" for the unphased run. */
  key: string;
  /** Null for lines that are not in a phase, so they render bare as before. */
  title: string | null;
  note: string | null;
  lines: T[];
  /** Net of the group, so a discount line inside a phase reduces its own phase. */
  subtotal: number;
}

/**
 * Split lines into the runs that share a phase, in document order.
 *
 * A new group starts whenever phase_position changes, which means the grouping
 * follows the order the lines are actually in rather than trying to reorder the
 * invoice behind the admin's back. Lines with no phase come back as a group with
 * a null title, which the document renders exactly as an unphased invoice.
 */
export function groupByPhase<T extends PhaseFields & { quantity: number; unit_amount: number }>(
  lines: T[],
): PhaseGroup<T>[] {
  const groups: PhaseGroup<T>[] = [];
  let currentPos: number | null | undefined;
  for (const l of lines) {
    const pos = l.phase_position ?? null;
    const last = groups[groups.length - 1];
    if (!last || pos !== currentPos) {
      groups.push({
        key: pos === null ? `none-${groups.length}` : `phase-${pos}`,
        title: pos === null ? null : (l.phase_title ?? "").trim() || `Phase ${pos + 1}`,
        note: pos === null ? null : (l.phase_note ?? "").trim() || null,
        lines: [l],
        subtotal: lineAmount(l),
      });
      currentPos = pos;
    } else {
      last.lines.push(l);
      last.subtotal = round(last.subtotal + lineAmount(l));
    }
  }
  return groups;
}

/** Is this invoice phased at all? Drives whether headings render. */
export function hasPhases(lines: PhaseFields[]): boolean {
  return lines.some((l) => l.phase_position !== null && l.phase_position !== undefined);
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

export interface HourlySummary {
  /** Hours across the charge lines. Discount lines are not hours. */
  hours: number;
  /**
   * The single rate every charge line is at, or null if they disagree. Null is
   * what makes the per-line Rate column come back: an invoice must never state
   * one rate at the bottom while its lines were billed at another.
   */
  rate: number | null;
}

/**
 * Read the hourly shape of a set of lines.
 *
 * On an hourly invoice the rate is the same on every line, so repeating it down
 * the page is noise; it belongs once, next to the totals. This works out whether
 * that collapse is honest.
 */
export function hourlySummary(
  lines: { quantity: number; unit_amount: number }[],
): HourlySummary {
  let hours = 0;
  const rates = new Set<number>();
  for (const l of lines) {
    // A discount is a negative line, not an hour worked.
    if (lineAmount(l) <= 0) continue;
    hours = round(hours + (Number(l.quantity) || 0));
    rates.add(Number(l.unit_amount));
  }
  return { hours, rate: rates.size === 1 ? [...rates][0] : null };
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
