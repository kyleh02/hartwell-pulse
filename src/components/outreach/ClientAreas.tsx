"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { addClientArea, removeClientArea } from "@/app/admin/outreach/actions";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

export interface AreaRow {
  id: string;
  client: string;
  place: string;
  postcode: string | null;
  services: string[];
  radius_km: number;
}

const EMPTY = { clientId: "", place: "", postcode: "", services: "", radiusKm: "15" };

/**
 * Where each client trades and what they sell. Draper skips any business
 * offering an overlapping service inside the radius, so it never pitches a
 * client's competitor down the road. Leave services empty to cover every kind
 * of business near that client.
 */
export function ClientAreas({ areas, clients }: { areas: AreaRow[]; clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState(EMPTY);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await addClientArea(f);
      setMsg(res.ok ? { ok: true, text: "Added." } : { ok: false, text: res.message });
      if (res.ok) setF({ ...EMPTY, clientId: f.clientId });
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await removeClientArea(id);
      if (!res.ok) setMsg({ ok: false, text: res.message });
      router.refresh();
    });
  }

  return (
    <div>
      {areas.length === 0 ? (
        <p className="mb-3 text-[13px] text-pulse-text-mute">No client areas yet.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {areas.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/40 px-3 py-2"
            >
              <div className="min-w-0 text-[13px]">
                <p className="text-pulse-text">
                  {a.client}: {a.place} {a.postcode}
                  <span className="text-pulse-text-mute"> · {Number(a.radius_km)} km</span>
                </p>
                <p className="text-[12px] text-pulse-text-dim">
                  {a.services.length ? a.services.join(", ") : "Every kind of business"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(a.id)}
                disabled={pending}
                aria-label={`Remove ${a.client}, ${a.place}`}
                className="shrink-0 rounded p-1 text-pulse-text-mute hover:text-pulse-danger"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_0.6fr]">
        <select className={field} value={f.clientId} onChange={set("clientId")} aria-label="Client">
          <option value="">Client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className={field} placeholder="Suburb or town" value={f.place} onChange={set("place")} />
        <input className={field} placeholder="Postcode" inputMode="numeric" value={f.postcode} onChange={set("postcode")} />
        <input
          className={`${field} sm:col-span-2`}
          placeholder="What they sell, comma separated (blank for everything)"
          value={f.services}
          onChange={set("services")}
        />
        <div className="flex gap-2">
          <input className={field} placeholder="km" inputMode="numeric" value={f.radiusKm} onChange={set("radiusKm")} aria-label="Radius in km" />
          <Button type="submit" disabled={pending}>
            Add
          </Button>
        </div>
        {msg && <p className={msg.ok ? "text-xs text-pulse-success sm:col-span-3" : "text-xs text-pulse-danger sm:col-span-3"}>{msg.text}</p>}
      </form>
    </div>
  );
}
