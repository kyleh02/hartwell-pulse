import Link from "next/link";
import { formatMoney } from "@/lib/invoices-shared";
import type { WorkStrip as Strip } from "@/lib/work";

/**
 * Six numbers above the list, each a link.
 *
 * "How are things" is a different question from "what do I do next", and it
 * gets three seconds and a strip rather than a dashboard of charts. Anything
 * that grows into a panel here is a page that gets looked at instead of worked
 * from.
 *
 * Every figure is counted from the system that owns it rather than derived
 * from whether a work item happens to exist, so the money owed is right even
 * if a generator has not run.
 */
export function WorkStrip({ strip }: { strip: Strip }) {
  const cells: {
    label: string;
    value: string;
    href: string;
    tone?: "warn" | "danger";
  }[] = [
    { label: "Owed", value: formatMoney(strip.owed), href: "/admin/invoices" },
    {
      label: "Overdue",
      value: formatMoney(strip.overdue),
      href: "/admin/invoices",
      tone: strip.overdue > 0 ? "danger" : undefined,
    },
    {
      label: "Sends this week",
      value: String(strip.sendsThisWeek),
      href: "/admin/crm/plan",
    },
    {
      label: "Reports in draft",
      value: String(strip.reportsDue),
      href: "/admin/reports",
    },
    { label: "Snoozed", value: String(strip.snoozed), href: "/admin" },
    { label: "Open", value: String(strip.open), href: "/admin" },
  ];

  return (
    <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className="lift rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface px-4 py-3.5"
        >
          <p className="mono-label leading-tight">{c.label}</p>
          <p
            className={`data-mono mt-2 text-xl leading-none ${
              c.tone === "danger"
                ? "text-pulse-danger"
                : c.tone === "warn"
                  ? "text-pulse-warn"
                  : "text-pulse-text"
            }`}
          >
            {c.value}
          </p>
        </Link>
      ))}
    </div>
  );
}
