"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { AdminInvoiceRow } from "@/lib/invoices";
import type { InvoiceStatus } from "@/lib/types/database";
import { formatMoney } from "@/lib/invoices-shared";
import { deleteInvoice } from "@/app/admin/invoices/actions";
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
  const [pending, startTransition] = useTransition();

  function handleDelete(id: string) {
    if (
      !window.confirm(
        "Delete this draft invoice? This permanently removes it and can't be undone.",
      )
    )
      return;
    startTransition(async () => {
      await deleteInvoice(id);
    });
  }

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
              <div key={inv.id} className="flex items-stretch gap-2">
                <Link
                  href={`/admin/invoices/${inv.id}`}
                  className="block min-w-0 flex-1"
                >
                  <Card className="flex h-full items-center justify-between gap-3 p-4 transition-colors hover:border-pulse-border-strong">
                    <div className="min-w-0">
                      <p className="font-medium text-pulse-text">
                        {inv.client_name}
                        {inv.recurring_active && (
                          <span className="data-mono ml-2 text-[10px] uppercase tracking-wider text-pulse-gold">
                            retainer
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
                {inv.status === "draft" && (
                  <button
                    type="button"
                    onClick={() => handleDelete(inv.id)}
                    disabled={pending}
                    aria-label={`Delete draft ${inv.invoice_number}`}
                    title="Delete draft"
                    className="flex shrink-0 items-center rounded-[var(--radius-card)] border border-pulse-border px-3 text-pulse-text-mute transition-colors hover:border-pulse-danger hover:text-pulse-danger disabled:opacity-50"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
