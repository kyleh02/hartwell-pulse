"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Paperclip, Send, SmilePlus, Smile, FileText } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { Message, MessageReaction } from "@/lib/types/database";
import { isImageMime } from "@/lib/assets-shared";
import { cn } from "@/lib/utils/cn";

interface Attachment {
  path: string;
  name: string;
  mime: string | null;
  size: number | null;
}

const QUICK_EMOJIS = ["👍", "❤️", "🎉", "✅", "👀", "🙏"];

// Larger palette for writing emojis into the message itself.
const COMPOSER_EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎",
  "🤔", "😅", "😉", "🙌", "👏", "👍", "👎", "🙏",
  "💪", "🔥", "✨", "🎉", "❤️", "💛", "✅", "❌",
  "👀", "💯", "🚀", "📈", "📉", "⭐", "👋", "💬",
];

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function attachmentsOf(m: Message): Attachment[] {
  return (m.attachments as unknown as Attachment[] | null) ?? [];
}

export function ChatThread({
  clientId,
  role,
  peerName,
}: {
  clientId: string;
  role: "client" | "admin";
  peerName: string;
}) {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [{ data: msgs }, { data: rx }] = await Promise.all([
      supabase
        .from("messages")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true }),
      supabase.from("message_reactions").select("*").eq("client_id", clientId),
    ]);
    const list = (msgs as Message[] | null) ?? [];
    setMessages(list);
    setReactions((rx as MessageReaction[] | null) ?? []);

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
  }, [supabase, clientId]);

  // Viewing a conversation is the read receipt: clear this user's unread message
  // notifications for this client. That's what stops the 30-minute unread-message
  // email reminder from firing for messages you've already seen on the page.
  const markRead = useCallback(async () => {
    if (!userId) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_user_id", userId)
      .eq("client_id", clientId)
      .eq("type", "message")
      .is("read_at", null);
  }, [supabase, userId, clientId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // light polling keeps the conversation live without extra Supabase config
  useEffect(() => {
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    setBusy(true);
    setBody("");
    setPickerOpen(false);
    const { error } = await supabase.from("messages").insert({
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
    setBusy(true);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${clientId}/messages/${newId()}-${safe}`;
    const up = await supabase.storage
      .from("pulse-assets")
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (!up.error) {
      const attachment: Attachment = {
        path,
        name: file.name,
        mime: file.type || null,
        size: file.size,
      };
      await supabase.from("messages").insert({
        client_id: clientId,
        sender_user_id: userId,
        sender_role: role,
        body: "",
        attachments: [attachment],
      });
      await load();
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
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
    <div className="flex h-[72vh] flex-col overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
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
            return (
              <div key={m.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[78%]", own && "items-end")}>
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-base leading-relaxed",
                      own
                        ? "bg-pulse-gold/15 text-pulse-text"
                        : "bg-pulse-surface-2 text-pulse-text",
                    )}
                  >
                    {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                    {attachmentsOf(m).map((a) =>
                      isImageMime(a.mime) && urls[a.path] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={a.path}
                          src={urls[a.path]}
                          alt={a.name}
                          className="mt-1 max-h-60 rounded-lg border border-pulse-border"
                        />
                      ) : (
                        <a
                          key={a.path}
                          href={urls[a.path] ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-2 rounded-lg border border-pulse-border bg-pulse-surface px-3 py-2 text-xs text-pulse-text-dim hover:text-pulse-text"
                        >
                          <FileText size={14} /> {a.name}
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
                      {own ? "You" : peerName} ·{" "}
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
                      {reactingTo === m.id && (
                        <div className="absolute bottom-6 right-0 z-10 flex gap-1 rounded-full border border-pulse-border bg-pulse-surface px-2 py-1 shadow-lg">
                          {QUICK_EMOJIS.map((e) => (
                            <button
                              key={e}
                              type="button"
                              onClick={() => toggleReaction(m.id, e)}
                              className="text-sm hover:scale-110"
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

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
            <div className="absolute bottom-12 left-0 z-20 grid w-64 grid-cols-8 gap-0.5 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-2 shadow-lg">
              {COMPOSER_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => insertEmoji(e)}
                  className="rounded p-1 text-lg hover:bg-pulse-surface-2"
                >
                  {e}
                </button>
              ))}
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
