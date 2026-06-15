"use client";

import { useState } from "react";
import Link from "next/link";
import type { AdminInvoiceRow } from "@/lib/invoices";
import type { InvoiceStatus } from "@/lib/types/database";
import { formatMoney } from "@/lib/invoices-shared";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";

const TONE: Record<InvoiceStatus, "neutral" | "gold" | "success" | "danger"> = {
  draft: "neutral",
  sent: "gold",
  paid: "success",
  void: "danger",
};

type Filter = "all" | "draft" | "sent" | "overdue" | "paid" | "void";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
];

function pretty(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function InvoicesLibrary({
  invoices,
  today,
}: {
  invoices: AdminInvoiceRow[];
  today: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const isOverdue = (inv: AdminInvoiceRow) =>
    inv.status === "sent" && inv.due_date.slice(0, 10) < today;
  const thisMonth = today.slice(0, 7);

  const outstanding = invoices
    .filter((i) => i.status === "sent")
    .reduce((s, i) => s + Number(i.total), 0);
  const paidThisMonth = invoices
    .filter((i) => i.status === "paid" && i.paid_at?.slice(0, 7) === thisMonth)
    .reduce((s, i) => s + Number(i.total), 0);
  const overdueCount = invoices.filter(isOverdue).length;

  const filtered = invoices.filter((inv) => {
    if (filter === "all") return true;
    if (filter === "overdue") return isOverdue(inv);
    return inv.status === filter;
  });

  return (
    <div>
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="mono-label">Outstanding</p>
          <p className="data-mono mt-1 text-xl text-pulse-text sm:text-2xl">
            {formatMoney(outstanding)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="mono-label">Paid this month</p>
          <p className="data-mono mt-1 text-xl text-pulse-success sm:text-2xl">
            {formatMoney(paidThisMonth)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="mono-label">Overdue</p>
          <p className="data-mono mt-1 text-xl text-pulse-danger sm:text-2xl">
            {overdueCount}
          </p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              filter === f.key
                ? "bg-pulse-surface-2 text-pulse-text"
                : "text-pulse-text-dim hover:text-pulse-text",
            )}
          >
            {f.label}
            {f.key === "overdue" && overdueCount > 0 && (
              <span className="ml-1 text-pulse-danger">{overdueCount}</span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-pulse-text-dim">No invoices in this view.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((inv) => {
            const overdue = isOverdue(inv);
            return (
              <Link key={inv.id} href={`/admin/invoices/${inv.id}`}>
                <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-pulse-border-strong">
                  <div className="min-w-0">
                    <p className="font-medium text-pulse-text">
                      {inv.client_name}
                      {inv.recurring && (
                        <span className="data-mono ml-2 text-[10px] uppercase tracking-wider text-pulse-gold">
                          recurring
                        </span>
                      )}
                    </p>
                    <p className="data-mono mt-0.5 truncate text-xs text-pulse-text-mute">
                      {inv.invoice_number} · due {pretty(inv.due_date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="data-mono text-sm text-pulse-text">
                      {formatMoney(inv.total)}
                    </span>
                    {overdue ? (
                      <Badge tone="danger">overdue</Badge>
                    ) : (
                      <Badge tone={TONE[inv.status]}>{inv.status}</Badge>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
