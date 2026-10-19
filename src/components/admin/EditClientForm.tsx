"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { updateClient } from "@/app/admin/clients/actions";
import { checkAbn, formatAbn } from "@/lib/billing";

const fieldCls =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

export function EditClientForm({
  clientId,
  businessName,
  serviceTier,
  status,
  legalName = null,
  abn = null,
  billingAddress = null,
  billingAttention = null,
}: {
  clientId: string;
  businessName: string;
  serviceTier: string;
  status: string;
  legalName?: string | null;
  abn?: string | null;
  billingAddress?: string | null;
  billingAttention?: string | null;
}) {
  const router = useRouter();
  const initial = {
    businessName,
    serviceTier,
    status,
    legalName: legalName ?? "",
    // Shown the way it is written on paper, stored as plain digits.
    abn: abn ? formatAbn(abn) : "",
    billingAddress: billingAddress ?? "",
    billingAttention: billingAttention ?? "",
  };
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(initial);

  // Checked as it is typed, so a mistyped digit is caught here rather than
  // printed on a tax invoice, where it would name a different business.
  const abnCheck = checkAbn(form.abn);

  function close() {
    setOpen(false);
    setError(null);
    setForm(initial);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (abnCheck.problem) {
      setError(abnCheck.problem);
      return;
    }
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
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5 shadow-xl"
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
              <label className="flex flex-col gap-1">
                <span className="mono-label">Status</span>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className={fieldCls}
                >
                  <option value="onboarding">Onboarding</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused (inactive)</option>
                </select>
              </label>

              <div className="border-t border-pulse-border pt-4">
                <p className="mono-label">Billing details</p>
                <p className="mt-1 text-xs text-pulse-text-dim">
                  Printed in the Bill to block of their invoices. All optional.
                </p>
              </div>

              <label className="flex flex-col gap-1">
                <span className="mono-label">Legal entity name</span>
                <input
                  value={form.legalName}
                  onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                  className={fieldCls}
                  placeholder="Only if it differs, e.g. Deesha Global Pty Ltd"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="mono-label">ABN</span>
                <input
                  value={form.abn}
                  onChange={(e) => setForm({ ...form, abn: e.target.value })}
                  inputMode="numeric"
                  className={`${fieldCls} data-mono`}
                  placeholder="11 digits"
                />
                {form.abn.trim() !== "" &&
                  (abnCheck.problem ? (
                    <span className="text-xs text-pulse-danger">{abnCheck.problem}</span>
                  ) : (
                    <span className="text-xs text-pulse-success">
                      Valid ABN, prints as {formatAbn(abnCheck.abn ?? "")}
                    </span>
                  ))}
              </label>
              <label className="flex flex-col gap-1">
                <span className="mono-label">Billing address</span>
                <textarea
                  rows={3}
                  value={form.billingAddress}
                  onChange={(e) =>
                    setForm({ ...form, billingAddress: e.target.value })
                  }
                  className={`${fieldCls} resize-y`}
                  placeholder={"Street\nSuburb State Postcode"}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="mono-label">Attention</span>
                <input
                  value={form.billingAttention}
                  onChange={(e) =>
                    setForm({ ...form, billingAttention: e.target.value })
                  }
                  className={fieldCls}
                  placeholder="Who the invoice is for, e.g. Accounts"
                />
              </label>

              <p className="text-xs text-pulse-text-mute">
                Changes show straight away across the portal and on draft
                invoices. An invoice that has already been sent keeps the name
                and details it was issued with, so it always matches the PDF the
                client received. Correct and Resend it to update one.
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
                <Button
                  type="submit"
                  size="sm"
                  disabled={pending || abnCheck.problem !== null}
                >
                  {pending ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
