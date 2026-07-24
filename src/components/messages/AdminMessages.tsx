"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Users,
  X,
} from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import {
  startDirectConversation,
  createGroupConversation,
  deleteConversation,
  restoreConversation,
} from "@/app/admin/messages/actions";
import { ChatThread } from "@/components/messages/ChatThread";
import type { ConversationKind } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

const GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

interface ConversationRow {
  id: string;
  client_id: string;
  client_name: string;
  kind: ConversationKind;
  title: string | null;
  direct_user_name: string | null;
  deleted_at: string | null;
}

interface StartableDirect {
  client_id: string;
  client_name: string;
  clerk_user_id: string;
  user_name: string;
}

interface GroupableClient {
  id: string;
  business_name: string;
  users: { clerk_user_id: string; name: string }[];
}

function daysLeft(deletedAt: string): number {
  const ms = new Date(deletedAt).getTime() + GRACE_DAYS * DAY_MS - Date.now();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

function subLabel(c: ConversationRow): string {
  return c.kind === "group"
    ? (c.title ?? "Group chat")
    : (c.direct_user_name ?? "Direct");
}

export function AdminMessages({
  conversations,
  startableDirects,
  groupableClients,
}: {
  conversations: ConversationRow[];
  startableDirects: StartableDirect[];
  groupableClients: GroupableClient[];
}) {
  const supabase = useSupabaseClient();
  const router = useRouter();
  const active = conversations.filter((c) => !c.deleted_at);
  const deleted = conversations.filter((c) => c.deleted_at);

  const [selected, setSelected] = useState<string | null>(
    active[0]?.id ?? null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupFor, setGroupFor] = useState<GroupableClient | null>(null);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembers, setGroupMembers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [pending, startTransition] = useTransition();

  const current = active.find((c) => c.id === selected) ?? null;

  // Unread-per-thread dots for the list; refreshed on a light poll (opening a
  // thread clears its count via ChatThread's markRead).
  const loadUnread = useCallback(async () => {
    const { data } = await supabase.rpc("unread_message_counts");
    const rows =
      (data as { conversation_id: string; unread: number }[] | null) ?? [];
    setUnread(new Map(rows.map((r) => [r.conversation_id, Number(r.unread)])));
  }, [supabase]);

  useEffect(() => {
    void loadUnread();
    const t = setInterval(() => void loadUnread(), 15000);
    return () => clearInterval(t);
  }, [loadUnread]);

  function closePicker() {
    setPickerOpen(false);
    setGroupFor(null);
    setGroupTitle("");
    setGroupMembers(new Set());
    setError(null);
  }

  function startDirect(d: StartableDirect) {
    closePicker();
    startTransition(async () => {
      await startDirectConversation(d.client_id, d.clerk_user_id);
      router.refresh();
    });
  }

  function openGroupForm(g: GroupableClient) {
    setGroupFor(g);
    setGroupTitle(`${g.business_name} team`);
    setGroupMembers(new Set(g.users.map((u) => u.clerk_user_id)));
    setError(null);
  }

  function toggleGroupMember(id: string) {
    setGroupMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function createGroup() {
    if (!groupFor) return;
    setError(null);
    const clientId = groupFor.id;
    const title = groupTitle;
    const members = Array.from(groupMembers);
    startTransition(async () => {
      try {
        const id = await createGroupConversation(clientId, title, members);
        closePicker();
        setSelected(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  async function remove(c: ConversationRow) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.id);
    const n = count ?? 0;
    if (
      !window.confirm(
        `Delete "${c.client_name} · ${subLabel(c)}"?\n\nAll ${n} message${n === 1 ? "" : "s"} disappear for every member. You can restore it for ${GRACE_DAYS} days, after which it's permanently removed.`,
      )
    )
      return;
    startTransition(async () => {
      await deleteConversation(c.id);
      if (selected === c.id) setSelected(null);
      router.refresh();
    });
  }

  function restore(c: ConversationRow) {
    startTransition(async () => {
      await restoreConversation(c.id);
      setSelected(c.id);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="h-fit rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-2">
        <button
          type="button"
          onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
          disabled={pending}
          className="mb-1 flex w-full items-center gap-2 rounded-[var(--radius-input)] border border-dashed border-pulse-border px-3 py-2 text-left text-sm text-pulse-text-dim transition-colors hover:border-pulse-border-strong hover:text-pulse-text disabled:opacity-60"
        >
          {pickerOpen ? <X size={15} /> : <Plus size={15} />}
          New conversation
        </button>

        {pickerOpen && (
          <div className="mb-2 space-y-1 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/40 p-1">
            {groupFor ? (
              <div className="space-y-2 p-1.5">
                <p className="mono-label">
                  Group chat · {groupFor.business_name}
                </p>
                <input
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder="Group name"
                  className="w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2.5 py-1.5 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none"
                />
                {groupFor.users.map((u) => (
                  <label
                    key={u.clerk_user_id}
                    className="flex items-center gap-2 px-1 text-sm text-pulse-text-dim"
                  >
                    <input
                      type="checkbox"
                      checked={groupMembers.has(u.clerk_user_id)}
                      onChange={() => toggleGroupMember(u.clerk_user_id)}
                      className="accent-[var(--color-pulse-gold)]"
                    />
                    {u.name}
                  </label>
                ))}
                {error && (
                  <p className="text-xs text-pulse-danger">{error}</p>
                )}
                <div className="flex items-center justify-end gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setGroupFor(null)}
                    disabled={pending}
                    className="text-xs text-pulse-text-mute hover:text-pulse-text disabled:opacity-60"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={createGroup}
                    disabled={pending || groupMembers.size < 2}
                    className="rounded-[var(--radius-input)] bg-pulse-gold px-2.5 py-1 text-xs font-medium text-pulse-bg hover:bg-pulse-gold-light disabled:opacity-40"
                  >
                    {pending ? "Creating…" : "Create"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {startableDirects.length === 0 &&
                  groupableClients.length === 0 && (
                    <p className="px-2 py-1.5 text-xs text-pulse-text-mute">
                      Everyone already has a conversation.
                    </p>
                  )}
                {startableDirects.map((d) => (
                  <button
                    key={d.clerk_user_id}
                    type="button"
                    onClick={() => startDirect(d)}
                    disabled={pending}
                    className="block w-full rounded-[var(--radius-input)] px-2.5 py-1.5 text-left text-sm text-pulse-text-dim hover:bg-pulse-surface-2 hover:text-pulse-text disabled:opacity-60"
                  >
                    {d.client_name}
                    <span className="text-pulse-text-mute"> · {d.user_name}</span>
                  </button>
                ))}
                {groupableClients.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => openGroupForm(g)}
                    disabled={pending}
                    className="flex w-full items-center gap-1.5 rounded-[var(--radius-input)] px-2.5 py-1.5 text-left text-sm text-pulse-text-dim hover:bg-pulse-surface-2 hover:text-pulse-text disabled:opacity-60"
                  >
                    <Users size={13} />
                    {g.business_name} group chat…
                  </button>
                ))}
              </>
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
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-[var(--radius-input)] transition-colors",
                selected === c.id
                  ? "bg-pulse-surface-2"
                  : "hover:bg-pulse-surface-2/60",
              )}
            >
              <button
                type="button"
                onClick={() => setSelected(c.id)}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm",
                  selected === c.id
                    ? "text-pulse-text"
                    : "text-pulse-text-dim hover:text-pulse-text",
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pulse-gold/15 text-[11px] font-semibold text-pulse-gold">
                  {c.kind === "group" ? (
                    <Users size={13} strokeWidth={2} />
                  ) : (
                    c.client_name.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{c.client_name}</span>
                  <span className="block truncate text-[11px] text-pulse-text-mute">
                    {subLabel(c)}
                  </span>
                </span>
                {(unread.get(c.id) ?? 0) > 0 && (
                  <span className="data-mono ml-auto shrink-0 rounded-full bg-pulse-gold px-1.5 py-0.5 text-[10px] font-semibold text-pulse-bg">
                    {(unread.get(c.id) as number) > 9
                      ? "9+"
                      : unread.get(c.id)}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => void remove(c)}
                disabled={pending}
                aria-label={`Delete ${c.client_name} · ${subLabel(c)}`}
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
                  key={c.id}
                  className="flex items-center justify-between gap-2 px-3 py-1.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-pulse-text-mute">
                      {c.client_name} · {subLabel(c)}
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
            key={current.id}
            conversationId={current.id}
            clientId={current.client_id}
            kind={current.kind}
            role="admin"
            peerName={subLabel(current)}
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
