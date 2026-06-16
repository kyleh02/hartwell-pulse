"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/app/admin/clients/actions";

const fieldCls =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none";

export function NewClientForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    businessName: "",
    contactName: "",
    email: "",
    serviceTier: "Growth",
  });

  function reset() {
    setForm({ businessName: "", contactName: "", email: "", serviceTier: "Growth" });
    setError(null);
    setResult(null);
    setCopied(false);
  }
  function close() {
    setOpen(false);
    reset();
    router.refresh();
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await createClient(form);
        setResult(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }
  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(
        `Hartwell Pulse — your login\n` +
          `Portal: https://portal.hartwelldigital.com\n` +
          `Email: ${result.email}\n` +
          `Temporary password: ${result.password}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available; ignore
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={15} /> Add client
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
              <h2 className="text-base font-medium text-pulse-text">
                {result ? "Client created" : "Add a client"}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-pulse-text-mute transition-colors hover:text-pulse-text"
              >
                <X size={18} />
              </button>
            </div>

            {result ? (
              <div className="space-y-4">
                <p className="text-sm text-pulse-text-dim">
                  Their account is ready. Share these one-time login details with{" "}
                  <span className="text-pulse-text">{result.email}</span> — they can change
                  the password after signing in.
                </p>
                <div className="space-y-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3">
                  <Row label="Portal" value="portal.hartwelldigital.com" />
                  <Row label="Email" value={result.email} />
                  <Row label="Temp password" value={result.password} mono />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button variant="secondary" size="sm" onClick={copy}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy details"}
                  </Button>
                  <Button size="sm" onClick={close}>
                    Done
                  </Button>
                </div>
                <p className="text-xs text-pulse-text-mute">
                  This password is shown once. If it&apos;s lost, the client can reset it from
                  the sign-in page.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <Field label="Business name">
                  <input
                    required
                    value={form.businessName}
                    onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                    className={fieldCls}
                    placeholder="Acme Pty Ltd"
                  />
                </Field>
                <Field label="Contact name">
                  <input
                    value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className={fieldCls}
                    placeholder="Jane Smith"
                  />
                </Field>
                <Field label="Contact email (their login)">
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className={fieldCls}
                    placeholder="jane@acme.com"
                  />
                </Field>
                <Field label="Service tier">
                  <input
                    value={form.serviceTier}
                    onChange={(e) => setForm({ ...form, serviceTier: e.target.value })}
                    className={fieldCls}
                    placeholder="Growth"
                  />
                </Field>

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
                    {pending ? "Creating…" : "Create client"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono-label">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-pulse-text-mute">{label}</span>
      <span className={mono ? "data-mono text-pulse-text" : "text-pulse-text"}>{value}</span>
    </div>
  );
}
