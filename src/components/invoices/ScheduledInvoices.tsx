import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatMoney } from "@/lib/invoices-shared";
import type { AdminInvoiceRow } from "@/lib/invoices";
import { BUSINESS_TZ, businessDateParts, businessToday } from "@/lib/business-time";

/**
 * What is queued to bill itself, and when.
 *
 * Recurring templates are invisible in a list sorted by creation date: the
 * thing that will quietly charge a client next Tuesday looks identical to a
 * one-off from March. This pulls them out so the standing arrangements can be
 * seen at a glance.
 */

// The recurring cron's two runs, in UTC hours, as vercel.json has them: the
// morning send and the afternoon second try. The local hour is worked out per
// date rather than written in, because Melbourne's offset moves twice a year.
const SEND_RUN_UTC = 22;
const RETRY_RUN_UTC = 6;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function melbourneHour(at: Date) {
  return Number(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: BUSINESS_TZ,
      hour: "numeric",
      hourCycle: "h23",
    }).format(at),
  );
}

/** The Melbourne hour a run lands in on a given Melbourne date. */
function runHour(utcHour: number, day: Date) {
  const want = ymd(day);
  // Ahead of UTC, so a late UTC hour lands on the next local day.
  for (const back of [0, 1]) {
    const at = new Date(
      Date.UTC(day.getFullYear(), day.getMonth(), day.getDate() - back, utcHour),
    );
    if (businessToday(at) === want) return melbourneHour(at);
  }
  return utcHour;
}

function ampm(h: number) {
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
}

/**
 * The next invoice a template will send, by the cron's own rules.
 *
 * This month's billing day counts until this month's invoice has actually gone,
 * so on the day itself the card says today rather than jumping to next month
 * before anything was sent. A billing day before the template's own issue date
 * is skipped, because the cron never back-bills. A generated invoice still in
 * draft is a send that broke halfway, and the next run finishes it, so it is
 * still pending.
 */
function nextBilling(
  t: AdminInvoiceRow & { anchor: number },
  invoices: AdminInvoiceRow[],
): { day: Date; pending: boolean } {
  const { y, m, d } = businessDateParts();
  const setUp = t.issue_date.slice(0, 10);
  const period = ymd(new Date(y, m - 1, 1));
  const billed = invoices.some(
    (i) =>
      i.recurring_source_id === t.id &&
      i.recurring_period?.slice(0, 10) === period &&
      i.status !== "draft",
  );
  const thisMonth = new Date(y, m - 1, t.anchor);
  if (!billed && ymd(thisMonth) >= setUp) {
    // On or after the billing day it goes at the next run, dated that day.
    return d >= t.anchor
      ? { day: new Date(y, m - 1, d), pending: true }
      : { day: thisMonth, pending: false };
  }
  for (let k = 1; k <= 24; k++) {
    const next = new Date(y, m - 1 + k, t.anchor);
    if (ymd(next) >= setUp) return { day: next, pending: false };
  }
  return { day: new Date(y, m, t.anchor), pending: false };
}

/** When a pending invoice goes, read against the clock. */
function pendingWhen(day: Date) {
  const now = melbourneHour(new Date());
  // Hobby fires anywhere in the hour, so the hour itself still counts.
  const send = runHour(SEND_RUN_UTC, day);
  if (now <= send) return `today, ${ampm(send)}`;
  const retry = runHour(RETRY_RUN_UTC, day);
  if (now <= retry) return `today, ${ampm(retry)}`;
  const tomorrow = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return `not sent yet, next try tomorrow ${ampm(runHour(SEND_RUN_UTC, tomorrow))}`;
}

function pretty(d: Date) {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ScheduledInvoices({
  invoices,
  defaultTerms,
}: {
  invoices: AdminInvoiceRow[];
  defaultTerms: number;
}) {
  const templates = invoices
    .filter((i) => i.recurring_active)
    .map((i) => ({
      ...i,
      anchor: i.recurring_anchor_day ?? Number(i.issue_date.slice(8, 10)),
    }))
    .map((t) => ({ ...t, next: nextBilling(t, invoices) }))
    .sort((a, b) => a.next.day.getTime() - b.next.day.getTime());

  if (templates.length === 0) return null;

  const monthly = templates.reduce((sum, t) => sum + Number(t.total), 0);
  const { y, m, d } = businessDateParts();
  const today = new Date(y, m - 1, d);
  const sendAt = runHour(SEND_RUN_UTC, today);
  const retryAt = runHour(RETRY_RUN_UTC, today);

  return (
    <Card className="mb-5 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="mono-label flex items-center gap-2">
          <CalendarClock size={13} /> Scheduled
        </p>
        <p className="data-mono text-xs text-pulse-text-mute">
          {formatMoney(monthly)} a month across {templates.length}{" "}
          {templates.length === 1 ? "retainer" : "retainers"}
        </p>
      </div>

      <ul className="space-y-2">
        {templates.map((t) => {
          const { day, pending } = t.next;
          const terms = t.recurring_terms_days ?? defaultTerms;
          const due = new Date(day);
          due.setDate(due.getDate() + terms);
          return (
            <li key={t.id}>
              <Link
                href={`/admin/invoices/${t.id}`}
                className="lift flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/40 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-pulse-text">
                    {t.client_name}
                  </span>
                  <span className="data-mono block text-[11px] text-pulse-text-mute">
                    Bills on day {t.anchor} · {terms} day terms
                  </span>
                </span>
                <span className="text-right">
                  <span className="data-mono block text-sm text-pulse-text">
                    {formatMoney(Number(t.total))}
                  </span>
                  <span className="data-mono block text-[11px] text-pulse-gold">
                    {pending
                      ? pendingWhen(day)
                      : `next ${pretty(day)}, ${ampm(runHour(SEND_RUN_UTC, day))}`}
                  </span>
                  <span className="data-mono block text-[10px] text-pulse-text-mute">
                    due {pretty(due)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-2.5 text-[11px] text-pulse-text-mute">
        Each one makes and emails itself on its billing day, some time between{" "}
        {ampm(sendAt)} and {ampm((sendAt + 1) % 24)}. If that run misses, a second
        one between {ampm(retryAt)} and {ampm((retryAt + 1) % 24)} sends it. Paused
        or deleted clients are skipped automatically.
      </p>
    </Card>
  );
}
