"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
import { disconnect, type Connection } from "@/app/admin/settings/connector-actions";
import { BUSINESS_TZ } from "@/lib/business-time";
import { Button } from "@/components/ui/Button";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", { timeZone: BUSINESS_TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Settings: the address to give Claude, and what is connected now. */
export function ClaudeConnector({ url, connections }: { url: string; connections: Connection[] | null }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function copy() {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium text-pulse-text">Claude connector</h2>
      <div className="grid gap-4 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
        <p className="text-sm leading-relaxed text-pulse-text-dim">
          Lets Claude read and update your pipeline from any chat: who to follow up today, log a call, add a lead. It can&apos;t mark a lead
          won, delete one or email anyone.
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <code className="data-mono min-w-0 flex-1 truncate rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text">
            {url}
          </code>
          <Button size="sm" variant="secondary" onClick={copy} aria-label="Copy the connector address">
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-pulse-text-dim">
          <li>In Claude, open Settings, then Connectors, then Add custom connector.</li>
          <li>Name it Pulse pipeline and paste the address above.</li>
          <li>Press Connect. The portal asks you to allow it; press Allow.</li>
        </ol>
        {connections === null ? (
          <p className="text-sm text-pulse-text-mute">Run migration 0057 in the Supabase SQL Editor to switch this on.</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-pulse-text-mute">Nothing connected yet.</p>
        ) : (
          <ul className="divide-y divide-pulse-border border-t border-pulse-border">
            {connections.map((c) => (
              <li key={c.clientId} className="flex flex-wrap items-center justify-between gap-3 pt-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-pulse-text">{c.name}</p>
                  <p className="text-xs text-pulse-text-mute">
                    Connected {when(c.since)}
                    {c.lastUsed ? `, last used ${when(c.lastUsed)}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await disconnect(c.clientId);
                      router.refresh();
                    })
                  }
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
