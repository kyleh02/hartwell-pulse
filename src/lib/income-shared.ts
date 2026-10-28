import { businessToday } from "@/lib/business-time";
import { isSuperseded, outstandingOf } from "@/lib/invoices-shared";

/**
 * Kyle's income, worked out from his invoices. Pure, so it can be tested
 * without a database; `getIncome` in income.ts feeds it.
 *
 * What counts as money received, and when:
 * - A paid invoice counts in the month it was marked paid, for what was paid
 *   then: the total less any deposit already credited on it.
 * - That deposit counts in the month the invoice was issued, which is when it
 *   was taken. If deposits are ever billed as invoices of their own, this
 *   would count them twice, and this is the line to change.
 * - An invoice split into instalments counts through its instalments, never
 *   itself (`isSuperseded`), the same rule as every balance in the portal.
 * - Drafts, recurring templates and void invoices are not income.
 *
 * Months are Melbourne months, the financial year runs 1 July to 30 June.
 */

export interface IncomeInvoice {
  id: string;
  client_id: string;
  status: "draft" | "sent" | "paid" | "void";
  total: number | string;
  deposit_amount: number | string | null;
  issue_date: string;
  due_date: string;
  sent_at: string | null;
  paid_at: string | null;
  split_at: string | null;
  recurring_active: boolean | null;
}

export interface IncomeMonth {
  /** YYYY-MM */
  key: string;
  label: string;
  amount: number;
  /** The month still under way. */
  current: boolean;
}

export interface IncomeSummary {
  today: string;
  thisMonth: { label: string; amount: number };
  lastMonth: { label: string; amount: number };
  fy: {
    label: string;
    amount: number;
    /** The same stretch of last financial year, to the same day. */
    lastYearToDate: number;
  };
  months: IncomeMonth[];
  owed: { amount: number; count: number; overdue: number; overdueCount: number };
  retainers: { monthly: number; clients: number };
  /** Average days from sending to being paid, over the last twelve months. */
  daysToPay: number | null;
  byClient: { clientId: string | null; amount: number }[];
}

const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 100) / 100;
const money = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

/** A timestamp's date in Melbourne, YYYY-MM-DD. A plain date passes through. */
function localDate(v: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : businessToday(new Date(v));
}

function monthLabel(key: string, withYear = false): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-AU", {
    timeZone: "UTC",
    month: withYear ? "long" : "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The financial year a date falls in, by its starting calendar year. */
function fyStartYear(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return m >= 7 ? y : y - 1;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/** Money in, as dated receipts. */
export function receipts(invoices: IncomeInvoice[]): { date: string; amount: number; clientId: string }[] {
  const out: { date: string; amount: number; clientId: string }[] = [];
  for (const inv of invoices) {
    if (inv.status !== "paid" || !inv.paid_at || isSuperseded(inv) || inv.recurring_active) continue;
    const deposit = money(inv.deposit_amount);
    const rest = outstandingOf({ total: inv.total, deposit_amount: deposit });
    if (rest !== 0) out.push({ date: localDate(inv.paid_at), amount: rest, clientId: inv.client_id });
    if (deposit > 0) out.push({ date: localDate(inv.issue_date), amount: deposit, clientId: inv.client_id });
  }
  return out;
}

export function summariseIncome(invoices: IncomeInvoice[], now: Date = new Date()): IncomeSummary {
  const today = businessToday(now);
  const thisKey = today.slice(0, 7);
  const lastKey = addMonths(thisKey, -1);
  const money_in = receipts(invoices);

  const byMonth = new Map<string, number>();
  for (const r of money_in) {
    const k = r.date.slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + r.amount);
  }
  const months: IncomeMonth[] = Array.from({ length: 12 }, (_, i) => {
    const key = addMonths(thisKey, i - 11);
    return { key, label: monthLabel(key), amount: round(byMonth.get(key) ?? 0), current: key === thisKey };
  });

  // Financial year to date, and last year to the same day.
  const fyStart = fyStartYear(today);
  const fyFrom = `${fyStart}-07-01`;
  const lastFrom = `${fyStart - 1}-07-01`;
  const lastTo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  let fyAmount = 0;
  let lastYtd = 0;
  const clientTotals = new Map<string, number>();
  for (const r of money_in) {
    if (r.date >= fyFrom && r.date <= today) {
      fyAmount += r.amount;
      clientTotals.set(r.clientId, (clientTotals.get(r.clientId) ?? 0) + r.amount);
    }
    if (r.date >= lastFrom && r.date <= lastTo) lastYtd += r.amount;
  }

  // What is owed now. Same rule as the dashboard and the invoice list.
  let owed = 0;
  let owedCount = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const inv of invoices) {
    if (inv.status !== "sent" || isSuperseded(inv) || inv.recurring_active) continue;
    const amount = outstandingOf(inv);
    owed += amount;
    owedCount += 1;
    if (inv.due_date.slice(0, 10) < today) {
      overdue += amount;
      overdueCount += 1;
    }
  }

  // Retainers: the recurring templates that are switched on.
  const templates = invoices.filter((i) => i.recurring_active && i.status !== "void");
  const retainers = {
    monthly: round(templates.reduce((s, i) => s + outstandingOf(i), 0)),
    clients: new Set(templates.map((i) => i.client_id)).size,
  };

  // How long clients take to pay, over the last year.
  const yearAgo = businessToday(new Date(now.getTime() - 365 * DAY));
  const waits: number[] = [];
  for (const inv of invoices) {
    if (inv.status !== "paid" || !inv.paid_at || isSuperseded(inv)) continue;
    const paid = localDate(inv.paid_at);
    if (paid < yearAgo) continue;
    const sent = localDate(inv.sent_at ?? inv.issue_date);
    waits.push(Math.max(0, daysBetween(sent, paid)));
  }

  const byClient = [...clientTotals.entries()]
    .map(([clientId, amount]) => ({ clientId: clientId as string | null, amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);
  // Six clients by name, everyone else as one line. A long tail of thin bars
  // says nothing a single "Other" does not.
  const top = byClient.slice(0, 6);
  const rest = byClient.slice(6).reduce((s, c) => s + c.amount, 0);
  if (rest > 0) top.push({ clientId: null, amount: round(rest) });

  return {
    today,
    thisMonth: { label: monthLabel(thisKey, true), amount: round(byMonth.get(thisKey) ?? 0) },
    lastMonth: { label: monthLabel(lastKey, true), amount: round(byMonth.get(lastKey) ?? 0) },
    fy: {
      label: `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`,
      amount: round(fyAmount),
      lastYearToDate: round(lastYtd),
    },
    months,
    owed: { amount: round(owed), count: owedCount, overdue: round(overdue), overdueCount },
    retainers,
    daysToPay: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
    byClient: top,
  };
}
