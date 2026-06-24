"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { updateClient } from "@/app/admin/clients/actions";

const fieldCls =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

export function EditClientForm({
  clientId,
  businessName,
  serviceTier,
}: {
  clientId: string;
  businessName: string;
  serviceTier: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ businessName, serviceTier });

  function close() {
    setOpen(false);
    setError(null);
    setForm({ businessName, serviceTier });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await updateClient(clientId, form);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil size={13} /> Edit
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-medium text-pulse-text">Edit client</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-pulse-text-mute transition-colors hover:text-pulse-text"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="mono-label">Business name</span>
                <input
                  required
                  value={form.businessName}
                  onChange={(e) =>
                    setForm({ ...form, businessName: e.target.value })
                  }
                  className={fieldCls}
                  placeholder="SecureSupply"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="mono-label">Service tier</span>
                <input
                  value={form.serviceTier}
                  onChange={(e) =>
                    setForm({ ...form, serviceTier: e.target.value })
                  }
                  className={fieldCls}
                  placeholder="Growth"
                />
              </label>

              <p className="text-xs text-pulse-text-mute">
                Renaming updates this client everywhere — invoices, assets and
                dashboards all follow.
              </p>

              {error && (
                <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={close}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
