import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatMoney } from "@/lib/invoices-shared";
import type { AdminInvoiceRow } from "@/lib/invoices";

/**
 * What is queued to bill itself, and when.
 *
 * Recurring templates are invisible in a list sorted by creation date: the
 * thing that will quietly charge a client next Tuesday looks identical to a
 * one-off from March. This pulls them out so the standing arrangements can be
 * seen at a glance.
 */
function nextIssue(anchor: number): Date {
  // Brisbane, matching the cron that actually does the billing.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  // The billing day has passed this month, so the next one is next month.
  return d >= anchor ? new Date(y, m, anchor) : new Date(y, m - 1, anchor);
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
    .sort(
      (a, b) => nextIssue(a.anchor).getTime() - nextIssue(b.anchor).getTime(),
    );

  if (templates.length === 0) return null;

  const monthly = templates.reduce((sum, t) => sum + Number(t.total), 0);

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
          const next = nextIssue(t.anchor);
          const terms = t.recurring_terms_days ?? defaultTerms;
          const due = new Date(next);
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
                    next {pretty(next)}
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
        These generate and email themselves on their billing day. Paused or
        deleted clients are skipped automatically.
      </p>
    </Card>
  );
}
