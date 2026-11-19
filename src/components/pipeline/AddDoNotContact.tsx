"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDoNotContact } from "@/app/admin/pipeline/dnc-actions";
import { Button } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

const EMPTY = { email: "", name: "", business: "", website: "", abn: "", phone: "" };

/**
 * Someone replied "please remove me": put them on the list in ten seconds.
 * A no covers the whole business, so the website, ABN and phone help when
 * they are to hand; any one of email, website or business will do.
 */
export function AddDoNotContact() {
  const router = useRouter();
  const [f, setF] = useState(EMPTY);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await addDoNotContact(f);
      setMsg(res.ok ? { ok: true, text: res.note ? `Added. ${res.note}` : "Added." } : { ok: false, text: res.message });
      if (res.ok) setF(EMPTY);
      router.refresh();
    });
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <form onSubmit={add} className="grid gap-2 rounded-[20px] border border-pulse-border bg-pulse-surface p-4 sm:grid-cols-3">
      <input className={field} type="email" placeholder="Their email" value={f.email} onChange={set("email")} />
      <input className={field} placeholder="Name" value={f.name} onChange={set("name")} />
      <input className={field} placeholder="Business" value={f.business} onChange={set("business")} />
      <input className={field} placeholder="Website" value={f.website} onChange={set("website")} />
      <input className={field} placeholder="ABN" inputMode="numeric" value={f.abn} onChange={set("abn")} />
      <input className={field} placeholder="Phone" inputMode="tel" value={f.phone} onChange={set("phone")} />
      <div className="flex items-center justify-between gap-3 sm:col-span-3">
        <p className="text-xs text-pulse-text-mute">An email, website or business name, at least one.</p>
        <Button type="submit" disabled={pending}>
          Add
        </Button>
      </div>
      {msg && <p className={msg.ok ? "text-xs text-pulse-success sm:col-span-3" : "text-xs text-pulse-danger sm:col-span-3"}>{msg.text}</p>}
    </form>
  );
}
