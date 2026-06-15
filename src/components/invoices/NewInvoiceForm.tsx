"use client";

import { useState, useTransition } from "react";
import { createInvoice } from "@/app/admin/invoices/actions";
import { Button } from "@/components/ui/Button";

export function NewInvoiceForm({
  clients,
}: {
  clients: { id: string; business_name: string }[];
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  if (clients.length === 0) {
    return (
      <p className="text-sm text-pulse-text-dim">
        Add a client first (the demo seed creates Demo Co to try this with).
      </p>
    );
  }

  return (
    <div className="max-w-md space-y-4 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5">
      <label className="block">
        <span className="mono-label">Client</span>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1.5 w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.business_name}
            </option>
          ))}
        </select>
      </label>
      <Button onClick={() => startTransition(() => createInvoice(clientId))} disabled={pending}>
        {pending ? "Creating…" : "Create draft invoice"}
      </Button>
    </div>
  );
}
