"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Paperclip,
  Send,
  SmilePlus,
  Smile,
  FileText,
  Search,
  ChevronUp,
  ChevronDown,
  Download,
  X,
} from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import { EmojiPicker } from "@/components/messages/EmojiPicker";
import type {
  ConversationKind,
  ConversationMember,
  Message,
  MessageReaction,
} from "@/lib/types/database";
import { isImageMime } from "@/lib/assets-shared";
import { cn } from "@/lib/utils/cn";

interface Attachment {
  path: string;
  name: string;
  mime: string | null;
  size: number | null;
}

// Chat attachments stay small so threads load fast (the bucket enforces a hard
// 50 MB cap regardless; big files belong in Assets).
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const QUICK_EMOJIS = ["👍", "❤️", "🎉", "✅", "👀", "🙏"];

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function attachmentsOf(m: Message): Attachment[] {
  return (m.attachments as unknown as Attachment[] | null) ?? [];
}

/**
 * Render text with every occurrence of q highlighted. Matches case-insensitively
 * on the ORIGINAL string via regex, so indexes can't drift (toLowerCase changes
 * string length for some Unicode characters).
 */
function renderHighlighted(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <mark
        key={key++}
        className="rounded-sm bg-pulse-gold/40 px-0.5 text-pulse-text"
      >
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

export function ChatThread({
  conversationId,
  clientId,
  kind,
  role,
  peerName,
}: {
  conversationId: string;
  clientId: string;
  kind: ConversationKind;
  role: "client" | "admin";
  peerName: string;
}) {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // Pinned to the newest message until the user scrolls up to read history.
  const stickRef = useRef(true);

  // ---- in-conversation search ----
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q.length < 2) return [] as Message[];
    return messages.filter(
      (m) =>
        m.body.toLowerCase().includes(q) ||
        attachmentsOf(m).some((a) => a.name.toLowerCase().includes(q)),
    );
  }, [messages, q]);
  // Default to the newest match; arrows walk older/newer from there.
  const matchIdx = matches.findIndex((m) => m.id === currentMatchId);
  const effIdx = matchIdx >= 0 ? matchIdx : matches.length - 1;
  const currentMatch = matches.length > 0 ? matches[effIdx] : null;
  const currentMatchKey = currentMatch?.id ?? null;

  function stepMatch(dir: 1 | -1) {
    if (matches.length === 0) return;
    const next = Math.min(Math.max(effIdx + dir, 0), matches.length - 1);
    if (matches[next].id !== currentMatchKey) {
      setCurrentMatchId(matches[next].id);
    } else {
      // Clamped at the end (or same match): re-centre it anyway — the user may
      // have scrolled away since the last jump.
      stickRef.current = false;
      msgRefs.current
        .get(matches[next].id)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
    setCurrentMatchId(null);
  }

  // Pan to the current match (typing pans to the newest hit, arrows walk the
  // rest).
  useEffect(() => {
    if (!currentMatchKey) return;
    // Release the bottom-pin BEFORE panning: the smooth scroll starts inside
    // the "at the bottom" band, where the ResizeObserver / new-message re-pin
    // would otherwise cancel the pan and snap the view straight back down.
    stickRef.current = false;
    // Latch the selection: null means "newest match once", not a live pointer —
    // otherwise the 4s poll re-anchors it and yanks the view to any new hit.
    setCurrentMatchId((prev) => prev ?? currentMatchKey);
    msgRefs.current
      .get(currentMatchKey)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentMatchKey]);

  const load = useCallback(async () => {
    const [{ data: msgs }, { data: rx }, { data: mem }, { data: users }] =
      await Promise.all([
        supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
        supabase.from("message_reactions").select("*").eq("client_id", clientId),
        supabase
          .from("conversation_members")
          .select("*")
          .eq("conversation_id", conversationId),
        // Sender names + receipt names. Clients see their own client's users
        // (peer policy); Kyle's row isn't in it, so admin senders fall back to
        // "Kyle" below.
        supabase
          .from("client_users")
          .select("clerk_user_id, full_name")
          .eq("client_id", clientId),
      ]);
    const list = (msgs as Message[] | null) ?? [];
    setMessages(list);
    setReactions((rx as MessageReaction[] | null) ?? []);
    setMembers((mem as ConversationMember[] | null) ?? []);
    setNames(
      new Map(
        (
          (users as { clerk_user_id: string; full_name: string | null }[] | null) ??
          []
        ).map((u) => [u.clerk_user_id, u.full_name ?? "Teammate"]),
      ),
    );

    const paths = list.flatMap((m) => attachmentsOf(m).map((a) => a.path)).filter(Boolean);
    if (paths.length > 0) {
      const { data } = await supabase.storage
        .from("pulse-assets")
        .createSignedUrls(paths, 60 * 60);
      setUrls((prev) => {
        const next = { ...prev };
        for (const it of data ?? []) {
          if (it.path && it.signedUrl) next[it.path] = it.signedUrl;
        }
        return next;
      });
    }
    setLoading(false);
  }, [supabase, conversationId, clientId]);

  // The read receipt. Advancing last_read_at is what the other side sees as
  // "Seen", so it only moves when this thread is genuinely being looked at:
  // tab visible, window focused, and pinned to the newest message (scrolled-up
  // history reading doesn't count). Clearing the unread message notifications
  // keeps the bell honest and stops the 30-minute reminder email.
  const markRead = useCallback(async () => {
    if (!userId) return;
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    if (!stickRef.current) return;
    const now = new Date().toISOString();
    const receipt =
      role === "admin"
        ? // Kyle's member row may not exist yet on older threads.
          supabase.from("conversation_members").upsert(
            {
              conversation_id: conversationId,
              clerk_user_id: userId,
              last_read_at: now,
            },
            { onConflict: "conversation_id,clerk_user_id" },
          )
        : // A client's row always exists; RLS only lets them touch their own.
          supabase
            .from("conversation_members")
            .update({ last_read_at: now })
            .eq("conversation_id", conversationId)
            .eq("clerk_user_id", userId);
    await Promise.all([
      receipt,
      supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("recipient_user_id", userId)
        .eq("client_id", clientId)
        .eq("type", "message")
        .is("read_at", null),
    ]);
  }, [supabase, userId, role, conversationId, clientId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Realtime: new messages and read receipts land the moment they happen. RLS
  // scopes the events, so a client only ever hears about their own threads.
  useEffect(() => {
    const channel = supabase
      .channel(`pulse-conv-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, conversationId, load]);

  // Polling backstops realtime (Chrome throttles background tabs and sockets
  // drop), so the thread reconciles every few seconds regardless.
  useEffect(() => {
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  // Coming back to the tab or window counts as reading whatever is on screen.
  useEffect(() => {
    const h = () => void markRead();
    window.addEventListener("focus", h);
    document.addEventListener("visibilitychange", h);
    return () => {
      window.removeEventListener("focus", h);
      document.removeEventListener("visibilitychange", h);
    };
  }, [markRead]);

  // Keep the view pinned to the newest message while "stuck" to the bottom. A
  // one-off scroll on open isn't enough: image attachments finish loading after
  // the first paint, growing the thread and leaving the view stranded mid-way
  // up. The ResizeObserver re-pins through every late layout shift; scrolling up
  // to read history unpins, and returning to the bottom (or sending) re-pins.
  useEffect(() => {
    const el = listRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    // Within ~80px of the bottom counts as "at the bottom".
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    // Mark messages read on open and whenever new ones arrive while you're here.
    void markRead();
  }, [messages.length, markRead]);

  function insertEmoji(emoji: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setBody((b) => b + emoji);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + emoji + body.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  async function send() {
    const text = body.trim();
    if (!text || !userId || busy) return;
    stickRef.current = true; // your own message always brings you to the bottom
    setBusy(true);
    setBody("");
    setPickerOpen(false);
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      client_id: clientId,
      sender_user_id: userId,
      sender_role: role,
      body: text,
    });
    if (!error) await load();
    setBusy(false);
  }

  async function attach(file: File) {
    if (!userId) return;
    setAttachError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(
        `"${file.name}" is over the 25 MB chat limit. Pop bigger files in Assets instead.`,
      );
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    stickRef.current = true;
    setBusy(true);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${clientId}/messages/${newId()}-${safe}`;
    const up = await supabase.storage
      .from("pulse-assets")
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (up.error) {
      setAttachError(`Upload failed: ${up.error.message}`);
    } else {
      const attachment: Attachment = {
        path,
        name: file.name,
        mime: file.type || null,
        size: file.size,
      };
      const ins = await supabase.from("messages").insert({
        conversation_id: conversationId,
        client_id: clientId,
        sender_user_id: userId,
        sender_role: role,
        body: "",
        attachments: [attachment],
      });
      if (ins.error) setAttachError(`Couldn't send that file: ${ins.error.message}`);
      await load();
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  // Screenshots and copied images land as clipboard files named "image.png";
  // stamp them so downloads and the thread stay tellable-apart.
  function onPaste(e: React.ClipboardEvent) {
    const images = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (images.length === 0) return; // plain text pastes as normal
    e.preventDefault();
    void (async () => {
      for (const f of images) {
        const ext = (f.type.split("/")[1] ?? "png").split("+")[0];
        const stamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[T:]/g, "-");
        await attach(
          new File([f], `pasted-${stamp}.${ext}`, { type: f.type }),
        );
      }
    })();
  }

  // Force a real download (Content-Disposition: attachment) with the original
  // file name, rather than opening the image in a tab.
  async function download(a: Attachment) {
    const { data } = await supabase.storage
      .from("pulse-assets")
      .createSignedUrl(a.path, 60, { download: a.name });
    if (!data?.signedUrl) return;
    const link = document.createElement("a");
    link.href = data.signedUrl;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!userId) return;
    setReactingTo(null);
    const existing = reactions.find(
      (r) => r.message_id === messageId && r.user_id === userId && r.emoji === emoji,
    );
    if (existing) {
      setReactions((prev) => prev.filter((r) => r.id !== existing.id));
      await supabase.from("message_reactions").delete().eq("id", existing.id);
    } else {
      await supabase.from("message_reactions").insert({
        message_id: messageId,
        client_id: clientId,
        user_id: userId,
        emoji,
      });
      await load();
    }
  }

  function senderLabel(m: Message): string {
    if (m.sender_user_id === userId) return "You";
    if (m.sender_role === "admin") return "Kyle";
    return names.get(m.sender_user_id) ?? peerName;
  }

  // Only the newest of your own messages carries the receipt (everything above
  // it is implied read once that one is).
  const lastOwnId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_user_id === userId) return messages[i].id;
    }
    return null;
  }, [messages, userId]);

  function seenByFor(m: Message): string | null {
    const seen = members.filter(
      (x) =>
        x.clerk_user_id !== userId &&
        x.last_read_at &&
        new Date(x.last_read_at).getTime() >= new Date(m.created_at).getTime(),
    );
    if (seen.length === 0) return null;
    if (kind === "direct") return "Seen";
    return `Seen by ${seen
      .map((s) => names.get(s.clerk_user_id) ?? "Kyle")
      .join(", ")}`;
  }

  function reactionsFor(messageId: string) {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const r of reactions) {
      if (r.message_id !== messageId) continue;
      const e = map.get(r.emoji) ?? { count: 0, mine: false };
      e.count += 1;
      if (r.user_id === userId) e.mine = true;
      map.set(r.emoji, e);
    }
    return Array.from(map.entries());
  }

  return (
    <div
      onPaste={onPaste}
      className="relative flex h-[72vh] flex-col overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface"
    >
      {searchOpen ? (
        <div className="flex items-center gap-2 border-b border-pulse-border px-3 py-2">
          <Search size={14} className="shrink-0 text-pulse-text-mute" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCurrentMatchId(null);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape") closeSearch();
              else if (e.key === "Enter") {
                e.preventDefault();
                stepMatch(e.shiftKey ? 1 : -1);
              }
            }}
            placeholder="Search this conversation…"
            className="min-w-0 flex-1 bg-transparent text-sm text-pulse-text placeholder:text-pulse-text-mute focus:outline-none"
          />
          {q.length >= 2 && (
            <span className="data-mono shrink-0 text-[11px] text-pulse-text-mute">
              {matches.length === 0 ? "0/0" : `${effIdx + 1}/${matches.length}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => stepMatch(-1)}
            disabled={matches.length === 0}
            aria-label="Older match"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:text-pulse-text disabled:opacity-40"
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            onClick={() => stepMatch(1)}
            disabled={matches.length === 0}
            aria-label="Newer match"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:text-pulse-text disabled:opacity-40"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:text-pulse-text"
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setSearchOpen(true);
            // The search bar pushes the thread down a touch; keep the newest
            // message fully in view if we were pinned to the bottom.
            requestAnimationFrame(() => {
              const el = listRef.current;
              if (el && stickRef.current) el.scrollTop = el.scrollHeight;
            });
          }}
          aria-label="Search this conversation"
          title="Search this conversation"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-pulse-border bg-pulse-surface/90 text-pulse-text-mute backdrop-blur transition-colors hover:text-pulse-text"
        >
          <Search size={15} />
        </button>
      )}
      <div
        ref={listRef}
        onScroll={onListScroll}
        className="flex-1 overflow-y-auto p-4"
      >
        <div ref={innerRef} className="space-y-4">
        {loading ? (
          <p className="text-center text-xs text-pulse-text-mute">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-pulse-text-dim">
            No messages yet. Say hello to {peerName}.
          </p>
        ) : (
          messages.map((m) => {
            const own = m.sender_user_id === userId;
            const rx = reactionsFor(m.id);
            const isCurrentMatch = q.length >= 2 && currentMatchKey === m.id;
            const seenText =
              own && m.id === lastOwnId ? seenByFor(m) : null;
            return (
              <div
                key={m.id}
                ref={(el) => {
                  if (el) msgRefs.current.set(m.id, el);
                  else msgRefs.current.delete(m.id);
                }}
                className={cn("flex", own ? "justify-end" : "justify-start")}
              >
                <div className={cn("max-w-[78%]", own && "items-end")}>
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-base leading-relaxed",
                      own
                        ? "bg-pulse-gold/15 text-pulse-text"
                        : "bg-pulse-surface-2 text-pulse-text",
                      isCurrentMatch && "ring-1 ring-pulse-gold",
                    )}
                  >
                    {m.body && (
                      <p className="whitespace-pre-wrap">
                        {q.length >= 2 ? renderHighlighted(m.body, q) : m.body}
                      </p>
                    )}
                    {attachmentsOf(m).map((a) =>
                      isImageMime(a.mime) && urls[a.path] ? (
                        <div key={a.path} className="relative mt-1 w-fit">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={urls[a.path]}
                            alt={a.name}
                            className="max-h-60 rounded-lg border border-pulse-border"
                          />
                          <button
                            type="button"
                            onClick={() => void download(a)}
                            aria-label={`Download ${a.name}`}
                            title={`Download ${a.name}`}
                            className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full border border-pulse-border bg-pulse-bg/75 text-pulse-text-dim backdrop-blur transition-colors hover:text-pulse-text"
                          >
                            <Download size={13} />
                          </button>
                        </div>
                      ) : (
                        <a
                          key={a.path}
                          href={urls[a.path] ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-2 rounded-lg border border-pulse-border bg-pulse-surface px-3 py-2 text-xs text-pulse-text-dim hover:text-pulse-text"
                        >
                          <FileText size={14} />{" "}
                          {q.length >= 2 ? renderHighlighted(a.name, q) : a.name}
                        </a>
                      ),
                    )}
                  </div>

                  <div
                    className={cn(
                      "mt-1 flex items-center gap-2",
                      own ? "justify-end" : "justify-start",
                    )}
                  >
                    {rx.map(([emoji, info]) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => toggleReaction(m.id, emoji)}
                        className={cn(
                          "data-mono rounded-full border px-1.5 py-0.5 text-[11px]",
                          info.mine
                            ? "border-pulse-gold/40 bg-pulse-gold/10"
                            : "border-pulse-border",
                        )}
                      >
                        {emoji} {info.count}
                      </button>
                    ))}
                    <span className="data-mono text-[10px] text-pulse-text-mute">
                      {senderLabel(m)} ·{" "}
                      {new Date(m.created_at).toLocaleString("en-AU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Add reaction"
                        onClick={() =>
                          setReactingTo((cur) => (cur === m.id ? null : m.id))
                        }
                        className="text-pulse-text-mute hover:text-pulse-text"
                      >
                        <SmilePlus size={13} />
                      </button>
                      {/* The picker itself renders once at card level (below):
                          anchored popovers clip inside the scrolling list. */}
                    </div>
                  </div>

                  {seenText && (
                    <p className="data-mono mt-0.5 text-right text-[10px] text-pulse-gold/80">
                      {seenText}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
        </div>
      </div>

      {/* Reaction picker: one overlay above the composer, never clipped by the
          scroll area no matter where the message sits in the thread. */}
      {reactingTo && (
        <>
          <button
            type="button"
            aria-label="Close emoji picker"
            onClick={() => setReactingTo(null)}
            className="absolute inset-0 z-20 cursor-default"
          />
          <div className="absolute inset-x-3 bottom-20 z-30 mx-auto max-w-sm rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface shadow-xl">
            <div className="flex justify-between border-b border-pulse-border px-3 py-2">
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggleReaction(reactingTo, e)}
                  className="text-lg leading-none hover:scale-110"
                >
                  {e}
                </button>
              ))}
            </div>
            <EmojiPicker onPick={(e) => toggleReaction(reactingTo, e)} />
          </div>
        </>
      )}

      {attachError && (
        <p className="border-t border-pulse-border bg-pulse-danger/10 px-4 py-2 text-xs text-pulse-danger">
          {attachError}
        </p>
      )}
      <div className="flex items-end gap-2 border-t border-pulse-border p-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Attach a file"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void attach(f);
          }}
        />
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="Insert emoji"
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
          >
            <Smile size={18} />
          </button>
          {pickerOpen && (
            <div className="absolute bottom-12 left-0 z-20 w-72 max-w-[80vw] rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface shadow-lg">
              <EmojiPicker onPick={insertEmoji} />
            </div>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={`Message ${peerName}`}
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2.5 text-base text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !body.trim()}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-input)] bg-pulse-gold text-pulse-bg hover:bg-pulse-gold-light disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
