"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDoNotContact } from "@/app/admin/pipeline/dnc-actions";
import { Button } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

/** Someone replied "please remove me": put them on the list in ten seconds. */
export function AddDoNotContact() {
  const router = useRouter();
  const [f, setF] = useState({ email: "", name: "", business: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await addDoNotContact(f);
      setMsg(res.ok ? { ok: true, text: "Added." } : { ok: false, text: res.message });
      if (res.ok) setF({ email: "", name: "", business: "" });
      router.refresh();
    });
  }

  return (
    <form onSubmit={add} className="grid gap-2 rounded-[20px] border border-pulse-border bg-pulse-surface p-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
      <input className={field} type="email" placeholder="Their email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
      <input className={field} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className={field} placeholder="Business" value={f.business} onChange={(e) => setF({ ...f, business: e.target.value })} />
      <Button type="submit" disabled={pending}>
        Add
      </Button>
      {msg && <p className={msg.ok ? "text-xs text-pulse-success sm:col-span-4" : "text-xs text-pulse-danger sm:col-span-4"}>{msg.text}</p>}
    </form>
  );
}
