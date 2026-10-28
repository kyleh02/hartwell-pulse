"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { SOURCE_LABEL, type LeadSource } from "@/lib/pipeline-shared";
import { createLead } from "@/app/admin/pipeline/actions";
import { Button } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2.5 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

/** Quick add: the few things known on first contact. The rest can follow. */
export function NewLead() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", business: "", email: "", phone: "", service: "", value: "", source: "manual", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createLead(f);
      if (!res.ok) return setError(res.message);
      if (res.warning) window.alert(res.warning);
      setOpen(false);
      router.push(`/admin/pipeline/${res.id}`);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden="true" /> New lead
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <form
            onSubmit={save}
            role="dialog"
            aria-label="New lead"
            className="relative max-h-[90dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-[20px] border border-pulse-border bg-pulse-surface p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="card-title">New lead</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-pulse-text-mute hover:text-pulse-text">
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={field} placeholder="Their name" value={f.name} onChange={set("name")} autoFocus />
              <input className={field} placeholder="Business" value={f.business} onChange={set("business")} />
              <input className={field} type="email" placeholder="Email" value={f.email} onChange={set("email")} />
              <input className={field} type="tel" placeholder="Phone" value={f.phone} onChange={set("phone")} />
            </div>
            <input className={field} placeholder="What they're after, e.g. a new website and Google Ads" value={f.service} onChange={set("service")} />
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={field} inputMode="decimal" placeholder="Worth, roughly ($)" value={f.value} onChange={set("value")} />
              <select className={field} value={f.source} onChange={set("source")}>
                {(Object.keys(SOURCE_LABEL) as LeadSource[]).map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <textarea className={field} rows={3} placeholder="Notes (optional)" value={f.notes} onChange={set("notes")} />
            {error && <p className="text-xs text-pulse-danger">{error}</p>}
            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Add lead"}
              </Button>
              <p className="text-xs text-pulse-text-mute">Follow-up set for tomorrow; change it on the lead.</p>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
