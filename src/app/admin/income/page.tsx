import { ArrowDown, ArrowUp } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { summariseIncome, type IncomeInvoice } from "@/lib/income-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { IncomeChart } from "@/components/income/IncomeChart";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Income" };

const dollars = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

/**
 * Kyle's income at a glance, worked out from his invoices with nothing to
 * enter. The rules for what counts and when are in lib/income-shared.ts.
 */
export default async function IncomePage() {
  const supabase = await createServerSupabase();
  const [{ data: invData, error }, { data: clientData }] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, client_id, status, total, deposit_amount, issue_date, due_date, sent_at, paid_at, split_at, recurring_active",
      ),
    supabase.from("clients").select("id, business_name"),
  ]);
  if (error) throw new Error(`Could not read invoices: ${error.message}`);

  const s = summariseIncome((invData as IncomeInvoice[] | null) ?? []);
  const names = new Map(
    ((clientData as { id: string; business_name: string }[] | null) ?? []).map((c) => [c.id, c.business_name]),
  );
  const maxClient = Math.max(1, ...s.byClient.map((c) => c.amount));
  const fyDelta =
    s.fy.lastYearToDate > 0 ? ((s.fy.amount - s.fy.lastYearToDate) / s.fy.lastYearToDate) * 100 : null;

  return (
    <div>
      <PageHeader
        label={["Income"]}
        title="Your income"
        description="Money received, money owed and where it comes from, worked out from your invoices. Nothing to enter."
      />

      {/* ---- the numbers ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          className="rounded-[20px] border border-pulse-gold/30 bg-pulse-surface p-6 sm:col-span-2 lg:row-span-2"
          style={{
            backgroundImage:
              "radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--pulse-gold) 14%, transparent) 0%, transparent 60%)",
          }}
        >
          <p className="text-[52px] leading-none font-extrabold tracking-[-0.02em] text-pulse-text">
            {dollars(s.thisMonth.amount)}
          </p>
          <p className="mt-3 text-sm text-pulse-text-dim">Received in {s.thisMonth.label} so far</p>
          <div className="gold-rule my-5" aria-hidden="true" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-bold text-pulse-text">{dollars(s.lastMonth.amount)}</p>
              <p className="mt-1 text-xs text-pulse-text-dim">Last month, {s.lastMonth.label}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-pulse-text">{dollars(s.fy.amount)}</p>
              <p className="mt-1 text-xs text-pulse-text-dim">{s.fy.label} to date</p>
              {fyDelta !== null ? (
                <p
                  className={cn(
                    "flex items-center gap-1 text-xs",
                    fyDelta >= 0 ? "text-pulse-success" : "text-pulse-danger",
                  )}
                >
                  {fyDelta >= 0 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}
                  {Math.abs(Math.round(fyDelta))}% on this time last year
                </p>
              ) : (
                <p className="text-xs text-pulse-text-mute">From 1 July</p>
              )}
            </div>
          </div>
        </div>

        <Stat
          label="Owed to you"
          value={dollars(s.owed.amount)}
          note={
            s.owed.count === 0
              ? "Nothing outstanding"
              : `${s.owed.count} invoice${s.owed.count === 1 ? "" : "s"}`
          }
        />
        <Stat
          label="Overdue"
          value={dollars(s.owed.overdue)}
          note={s.owed.overdueCount === 0 ? "Nothing late" : `${s.owed.overdueCount} past due`}
          tone={s.owed.overdueCount > 0 ? "warn" : undefined}
        />
        <Stat
          label="Retainers"
          value={`${dollars(s.retainers.monthly)}`}
          note={
            s.retainers.clients === 0
              ? "No recurring invoices yet"
              : `a month, from ${s.retainers.clients} client${s.retainers.clients === 1 ? "" : "s"}`
          }
        />
        <Stat
          label="Time to get paid"
          value={s.daysToPay === null ? "None yet" : `${s.daysToPay} day${s.daysToPay === 1 ? "" : "s"}`}
          note="Average, from sending to paid, last 12 months"
        />
      </div>

      {/* ---- month by month ---- */}
      <section className="mt-4 rounded-[20px] border border-pulse-border bg-pulse-surface p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="card-title">Received each month</h2>
          <p className="text-xs text-pulse-text-mute">Last 12 months. This month is lighter until it ends.</p>
        </div>
        <IncomeChart months={s.months} />
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-xs text-pulse-text-dim hover:text-pulse-text">
            Show the numbers
          </summary>
          <table className="mt-3 w-full max-w-md text-sm">
            <tbody>
              {s.months.map((m) => (
                <tr key={m.key} className="border-b border-pulse-border last:border-b-0">
                  <td className="py-1.5 text-pulse-text-dim">
                    {m.label} {m.key.slice(0, 4)}
                    {m.current ? " (so far)" : ""}
                  </td>
                  <td className="data-mono py-1.5 text-right text-pulse-text">{dollars(m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {/* ---- who it comes from ---- */}
      <section className="mt-4 rounded-[20px] border border-pulse-border bg-pulse-surface p-6">
        <h2 className="card-title mb-4">By client, {s.fy.label}</h2>
        {s.byClient.length === 0 ? (
          <p className="text-sm text-pulse-text-dim">Nothing received yet this financial year.</p>
        ) : (
          <ul className="space-y-3">
            {s.byClient.map((c) => (
              <li key={c.clientId ?? "other"} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
                <span className="truncate text-sm text-pulse-text-dim">
                  {c.clientId ? (names.get(c.clientId) ?? "Former client") : "Everyone else"}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn("h-3 rounded-r-[4px]", c.clientId ? "bg-pulse-gold" : "bg-pulse-text-mute")}
                    style={{ width: `${Math.max(2, (c.amount / maxClient) * 100) * 0.8}%` }}
                    aria-hidden="true"
                  />
                  <span className="shrink-0 text-sm font-semibold text-pulse-text">{dollars(c.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-4 text-xs text-pulse-text-mute">
        Paid invoices count in the month they were marked paid. A deposit credited on an invoice counts in
        the month the invoice was issued. Split invoices count through their instalments.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] border bg-pulse-surface p-5",
        tone === "warn" ? "border-pulse-warn/40" : "border-pulse-border",
      )}
    >
      <p className="text-[28px] leading-tight font-extrabold tracking-[-0.01em] text-pulse-text">{value}</p>
      <p className="mt-1 text-sm font-semibold text-pulse-text">{label}</p>
      <p className={cn("mt-0.5 text-xs", tone === "warn" ? "text-pulse-warn" : "text-pulse-text-dim")}>{note}</p>
    </div>
  );
}
