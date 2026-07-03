"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronRight, X } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import {
  startConversation,
  deleteConversation,
  restoreConversation,
} from "@/app/admin/messages/actions";
import { ChatThread } from "@/components/messages/ChatThread";
import { cn } from "@/lib/utils/cn";

const GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

interface ConversationRow {
  client_id: string;
  client_name: string;
  deleted_at: string | null;
}

function daysLeft(deletedAt: string): number {
  const ms = new Date(deletedAt).getTime() + GRACE_DAYS * DAY_MS - Date.now();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

export function AdminMessages({
  conversations,
  startableClients,
}: {
  conversations: ConversationRow[];
  startableClients: { id: string; business_name: string }[];
}) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const active = conversations.filter((c) => !c.deleted_at);
  const deleted = conversations.filter((c) => c.deleted_at);

  const [selected, setSelected] = useState<string | null>(
    active[0]?.client_id ?? null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [pending, startTransition] = useTransition();

  const current = active.find((c) => c.client_id === selected) ?? null;

  function start(clientId: string) {
    setPickerOpen(false);
    startTransition(async () => {
      await startConversation(clientId);
      setSelected(clientId);
      router.refresh();
    });
  }

  async function remove(c: ConversationRow) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("client_id", c.client_id);
    const n = count ?? 0;
    if (
      !window.confirm(
        `Delete the conversation with ${c.client_name}?\n\nAll ${n} message${n === 1 ? "" : "s"} disappear for both you and them. You can restore it for ${GRACE_DAYS} days, after which it's permanently removed.`,
      )
    )
      return;
    startTransition(async () => {
      await deleteConversation(c.client_id);
      if (selected === c.client_id) setSelected(null);
      router.refresh();
    });
  }

  function restore(c: ConversationRow) {
    startTransition(async () => {
      await restoreConversation(c.client_id);
      setSelected(c.client_id);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="h-fit rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-2">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          disabled={pending}
          className="mb-1 flex w-full items-center gap-2 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-3 py-2 text-left text-sm text-pulse-text-dim transition-colors hover:border-pulse-border-strong hover:text-pulse-text disabled:opacity-60"
        >
          {pickerOpen ? <X size={15} /> : <Plus size={15} />}
          New conversation
        </button>

        {pickerOpen && (
          <div className="mb-2 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/40 p-1">
            {startableClients.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-pulse-text-mute">
                Every client already has a conversation.
              </p>
            ) : (
              startableClients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => start(c.id)}
                  disabled={pending}
                  className="block w-full rounded-[var(--radius-input)] px-2.5 py-1.5 text-left text-sm text-pulse-text-dim hover:bg-pulse-surface-2 hover:text-pulse-text disabled:opacity-60"
                >
                  {c.business_name}
                </button>
              ))
            )}
          </div>
        )}

        {active.length === 0 ? (
          <p className="p-3 text-xs text-pulse-text-mute">
            No conversations yet. Start one above — or one appears when a client
            messages you.
          </p>
        ) : (
          active.map((c) => (
            <div
              key={c.client_id}
              className={cn(
                "group flex items-center gap-1 rounded-[var(--radius-input)] transition-colors",
                selected === c.client_id
                  ? "bg-pulse-surface-2"
                  : "hover:bg-pulse-surface-2/60",
              )}
            >
              <button
                type="button"
                onClick={() => setSelected(c.client_id)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm",
                  selected === c.client_id
                    ? "text-pulse-text"
                    : "text-pulse-text-dim hover:text-pulse-text",
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pulse-gold/15 text-[11px] font-semibold text-pulse-gold">
                  {c.client_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{c.client_name}</span>
              </button>
              <button
                type="button"
                onClick={() => void remove(c)}
                disabled={pending}
                aria-label={`Delete conversation with ${c.client_name}`}
                title="Delete conversation"
                className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute opacity-0 transition-opacity hover:text-pulse-danger focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}

        {deleted.length > 0 && (
          <div className="mt-2 border-t border-pulse-border pt-2">
            <button
              type="button"
              onClick={() => setShowDeleted((v) => !v)}
              className="mono-label flex w-full items-center gap-1.5 px-2 py-1 text-pulse-text-mute hover:text-pulse-text-dim"
            >
              {showDeleted ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              Recently deleted ({deleted.length})
            </button>
            {showDeleted &&
              deleted.map((c) => (
                <div
                  key={c.client_id}
                  className="flex items-center justify-between gap-2 px-3 py-1.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-pulse-text-mute">
                      {c.client_name}
                    </span>
                    <span className="data-mono block text-[10px] text-pulse-text-mute">
                      {daysLeft(c.deleted_at as string)}d left
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => restore(c)}
                    disabled={pending}
                    className="shrink-0 text-xs text-pulse-gold hover:underline disabled:opacity-60"
                  >
                    Restore
                  </button>
                </div>
              ))}
          </div>
        )}
      </aside>

      <div>
        {current ? (
          <ChatThread
            key={current.client_id}
            clientId={current.client_id}
            role="admin"
            peerName={current.client_name}
          />
        ) : (
          <p className="text-sm text-pulse-text-dim">
            {active.length === 0
              ? "Start a conversation to get going."
              : "Pick a conversation to open it."}
          </p>
        )}
      </div>
    </div>
  );
}
