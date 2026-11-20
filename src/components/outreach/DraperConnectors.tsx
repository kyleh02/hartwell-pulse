"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { disconnectDraper } from "@/app/admin/outreach/connector-actions";

export interface ConnectorRow {
  scope: string;
  name: string;
  url: string;
  what: string;
  connectedSince: string | null;
  lastUsed: string | null;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Draper's two connector addresses, whether each is connected, and Disconnect for each alone. */
export function DraperConnectors({ rows }: { rows: ConnectorRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setMsg("Couldn't copy: select the address and copy it by hand.");
    }
  };

  return (
    <div className="space-y-2 text-[13px]">
      {rows.map((r) => (
        <div key={r.scope} className="rounded-[var(--radius-input)] border border-pulse-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-pulse-text">{r.name}</p>
              <p className="text-[12px] text-pulse-text-mute">{r.what}</p>
            </div>
            <p className={r.connectedSince ? "text-[12px] text-pulse-success" : "text-[12px] text-pulse-text-mute"}>
              {r.connectedSince ? `Connected ${when(r.connectedSince)}${r.lastUsed ? `, last used ${when(r.lastUsed)}` : ""}` : "Not connected"}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="data-mono min-w-0 break-all rounded bg-pulse-surface-2 px-2 py-1 text-[12px] text-pulse-text">{r.url}</code>
            <Button type="button" size="sm" variant="secondary" onClick={() => copy(r.url)}>
              {copied === r.url ? "Copied" : "Copy"}
            </Button>
            {r.connectedSince && (
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await disconnectDraper(r.scope);
                    setMsg(res.ok ? `${r.name} disconnected.` : (res.message ?? "That didn't work."));
                    router.refresh();
                  })
                }
              >
                Disconnect
              </Button>
            )}
          </div>
        </div>
      ))}
      {msg && <p className="text-pulse-text-dim">{msg}</p>}
    </div>
  );
}
