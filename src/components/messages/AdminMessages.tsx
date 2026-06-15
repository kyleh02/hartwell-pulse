"use client";

import { useState } from "react";
import { ChatThread } from "@/components/messages/ChatThread";
import { cn } from "@/lib/utils/cn";

export function AdminMessages({
  clients,
}: {
  clients: { id: string; business_name: string }[];
}) {
  const [selected, setSelected] = useState<string | null>(clients[0]?.id ?? null);
  const current = clients.find((c) => c.id === selected) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="h-fit rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-2">
        {clients.length === 0 ? (
          <p className="p-3 text-xs text-pulse-text-mute">No clients yet.</p>
        ) : (
          clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[var(--radius-input)] px-3 py-2 text-left text-sm transition-colors",
                selected === c.id
                  ? "bg-pulse-surface-2 text-pulse-text"
                  : "text-pulse-text-dim hover:bg-pulse-surface-2/60 hover:text-pulse-text",
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pulse-gold/15 text-[11px] font-semibold text-pulse-gold">
                {c.business_name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{c.business_name}</span>
            </button>
          ))
        )}
      </aside>

      <div>
        {current ? (
          <ChatThread
            key={current.id}
            clientId={current.id}
            role="admin"
            peerName={current.business_name}
          />
        ) : (
          <p className="text-sm text-pulse-text-dim">
            Pick a client to open the conversation.
          </p>
        )}
      </div>
    </div>
  );
}
