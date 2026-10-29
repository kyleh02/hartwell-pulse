"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Msg = { role: "user" | "assistant"; content: string; handed_off?: boolean };

const STARTERS = ["What's waiting for my OK?", "How do I approve something?", "Where's my latest report?", "How do I upload files?"];

/**
 * "Quick answers": the client asks, the assistant answers as it writes. The
 * conversation still under way is loaded when the panel opens, and re-read
 * after each answer so a hand-off to Kyle is marked as such.
 */
export function AssistantThread({ onMessageKyle }: { onMessageKyle: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  async function load() {
    const res = await fetch("/api/assistant", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const j = (await res.json()) as { messages: Msg[] };
    setMessages(j.messages);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    setDraft("");
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        setMessages((m) => m.slice(0, -1));
        setError(t || "That didn't send. Try again, or message our team.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });
      }
      await load();
    } catch {
      setError("The connection dropped. Try again, or message our team.");
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="pt-2">
            <p className="text-sm leading-relaxed text-pulse-text-dim">
              Ask about the portal, your account or how we work, and get an answer straight away. Anything about prices or changes goes to
              our team, who read every conversation.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-full border border-pulse-border px-3 py-1.5 text-[13px] text-pulse-text-dim transition-colors hover:border-pulse-gold/60 hover:text-pulse-text"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map((m, i) => (
              <li key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap",
                    m.role === "user" ? "rounded-br-md bg-pulse-gold text-pulse-bg" : "rounded-bl-md border border-pulse-border bg-pulse-surface-2 text-pulse-text",
                  )}
                >
                  {m.role === "assistant" && !m.content && busy && i === messages.length - 1 ? (
                    <span className="inline-flex gap-1 py-1" aria-label="Writing">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pulse-text-mute" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pulse-text-mute [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pulse-text-mute [animation-delay:300ms]" />
                    </span>
                  ) : (
                    m.content
                  )}
                  {m.handed_off && <span className="mt-2 block text-xs font-semibold text-pulse-gold">Passed to our team</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div ref={end} />
      </div>

      <div className="shrink-0 border-t border-pulse-border px-3 pt-2 pb-3">
        {error && <p className="mb-2 px-1 text-xs text-pulse-danger">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={box}
            rows={1}
            value={draft}
            maxLength={1000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            placeholder="Ask a question"
            aria-label="Ask the assistant a question"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2.5 text-base text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none sm:text-sm"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Ask"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] bg-pulse-gold text-pulse-bg disabled:opacity-40"
          >
            <ArrowUp size={18} />
          </button>
        </form>
        <p className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-pulse-text-mute">
          <Sparkles size={11} aria-hidden="true" /> An AI assistant.{" "}
          <button type="button" onClick={onMessageKyle} className="text-pulse-gold underline-offset-2 hover:underline">
            Message our team instead
          </button>
        </p>
      </div>
    </div>
  );
}
