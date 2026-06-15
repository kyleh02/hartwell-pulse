"use client";

import { useState, useTransition } from "react";
import { createReportForClient } from "@/app/admin/reports/actions";
import { Button } from "@/components/ui/Button";

export function NewReportForm({
  clients,
  defaultMonth,
}: {
  clients: { id: string; business_name: string }[];
  defaultMonth: string;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [month, setMonth] = useState(defaultMonth);
  const [pending, startTransition] = useTransition();

  if (clients.length === 0) {
    return (
      <p className="text-sm text-pulse-text-dim">
        Add a client first. Running the demo seed creates Demo Co to try this
        with.
      </p>
    );
  }

  function submit() {
    if (!clientId || !month) return;
    startTransition(() => createReportForClient(clientId, `${month}-01`));
  }

  const field =
    "mt-1.5 w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

  return (
    <div className="max-w-md space-y-4 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5">
      <label className="block">
        <span className="mono-label">Client</span>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className={field}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.business_name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mono-label">Month</span>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className={field}
        />
      </label>
      <Button onClick={submit} disabled={pending}>
        {pending ? "Creating…" : "Create report"}
      </Button>
    </div>
  );
}
