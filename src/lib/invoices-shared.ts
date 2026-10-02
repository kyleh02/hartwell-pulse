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

/**
 * Move a dragged line to where it was dropped, and give it the phase it landed in.
 *
 * `overId` is either another line's id, or "phase:<n>" / "phase:none" for a drop
 * on the phase itself rather than on one of its lines.
 *
 * The insertion index for a drop on a line is that line's index in the ORIGINAL
 * list, not in the list with the dragged one already removed. That is the index
 * dnd-kit slides the other rows to preview, and the two differ by one whenever
 * the drag was downward, which lands the line a place short of where the preview
 * promised. A drop on the phase itself appends to the end of that phase, which is
 * the only way to get a line past the last one in it.
 */
export function moveLine(
  lines: LineDraft[],
  activeId: string,
  overId: string,
): LineDraft[] {
  const oldIndex = lines.findIndex((l) => l.id === activeId);
  if (oldIndex < 0) return lines;
  const moving = lines[oldIndex];
  const rest = lines.filter((l) => l.id !== activeId);

  let targetPos: number | null;
  let at: number;
  if (overId.startsWith("phase:")) {
    const raw = overId.slice("phase:".length);
    targetPos = raw === "none" ? null : Number(raw);
    let last = -1;
    rest.forEach((l, i) => {
      if ((l.phase_position ?? null) === targetPos) last = i;
    });
    at = last < 0 ? rest.length : last + 1;
  } else {
    const overIndex = lines.findIndex((l) => l.id === overId);
    if (overIndex < 0) return lines;
    targetPos = lines[overIndex].phase_position;
    at = overIndex;
  }

  // The heading is copied onto every line of a phase, so a line arriving in one
  // has to take that heading or it would start a second run under its old title.
  const head =
    targetPos === null
      ? undefined
      : rest.find((l) => l.phase_position === targetPos);
  const moved: LineDraft = {
    ...moving,
    phase_position: targetPos,
    phase_title: targetPos === null ? "" : (head?.phase_title ?? moving.phase_title),
    phase_note: targetPos === null ? "" : (head?.phase_note ?? moving.phase_note),
  };
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
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

/**
 * What is actually still owed on an invoice.
 *
 * The total less any deposit already credited. The document has always shown
 * this as "Amount due", but every aggregation in the app summed the raw total,
 * so a deposit made the dashboard, the work list and the reminder emails all
 * overstate. A reminder quoting more than is owed is the kind of thing a client
 * notices.
 */
export function outstandingOf(inv: {
  total: number | string;
  deposit_amount?: number | string | null;
}): number {
  return round(Number(inv.total ?? 0) - Number(inv.deposit_amount ?? 0));
}

/**
 * Has this invoice been replaced by its instalments?
 *
 * A split invoice is still a record of what was agreed, and the client keeps
 * seeing it, but the money it names now lives on its instalments. Counting both
 * is the one mistake this feature could make that would show up as a wrong
 * figure in front of a client, so it is one predicate used everywhere rather
 * than a filter remembered in each place.
 */
export function isSuperseded(inv: { split_at?: string | null }): boolean {
  return !!inv.split_at;
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
  /** On an instalment: the invoice it was split out of. */
  parent?: Invoice | null;
  /** On an instalment: every part of the split, this one included, in order. */
  siblings?: Invoice[];
  /**
   * On an instalment: the original invoice's line items, so the document can
   * say what the money is for without repricing any of it.
   */
  parentLines?: InvoiceLineItem[];
}
