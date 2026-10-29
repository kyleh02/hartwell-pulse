"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Maximize2, MessageCircle, MessageSquare, Sparkles, Users, X } from "lucide-react";
import { ChatThread } from "@/components/messages/ChatThread";
import { AssistantThread } from "@/components/assistant/AssistantThread";
import { UnreadMessagesBadge } from "@/components/messages/UnreadMessagesBadge";
import type { ClientConversationRow } from "@/components/messages/ClientMessages";
import { HARTWELL } from "@/lib/brand";
import { cn } from "@/lib/utils/cn";

const OPEN_EVENT = "pulse:open-chat";

/** Open the chat panel from anywhere: the Home buttons, a link, a step. */
export function openChat() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * The chat bubble, bottom right of every client page except Messages itself.
 *
 * Messages used to be a tab, which meant a question had to wait until the
 * client was done with whatever page they were on, and on a phone it meant
 * leaving it. This is the pattern every support widget settled on: a bubble
 * that is always in reach, and a panel over the page that keeps your place. It
 * is the SAME conversation as the Messages tab, through the same ChatThread,
 * so there is one chat with two ways in rather than two chats.
 *
 * The thread mounts only while the panel is open. ChatThread marks messages
 * read as soon as it shows them, and a hidden one would tell Kyle a message had
 * been seen when nobody had looked.
 *
 * From the small breakpoint up it is a 380px panel above the bubble, as on the
 * web. Below it, the panel takes the whole screen like a messaging app, with
 * the message box at the bottom and the safe areas respected.
 */
export function ChatLauncher({
  conversations,
  clientId,
  assistant = false,
  staffNames,
}: {
  conversations: ClientConversationRow[];
  clientId: string;
  /** Team first names, so each message says who it is from. */
  staffNames?: Record<string, string>;
  /** Kyle has switched the assistant on (0059) and an API key is set. */
  assistant?: boolean;
}) {
  // Shell leaves this out on Messages itself, which already is the chat.
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  // The direct thread with Kyle unless they choose otherwise: it is what the
  // bubble promises.
  const [activeId, setActiveId] = useState<string | null>(
    () => (conversations.find((c) => c.kind !== "group") ?? conversations[0])?.id ?? null,
  );
  const active = conversations.find((c) => c.id === activeId) ?? conversations[0] ?? null;
  // Kyle first, always: the bubble is a line to him. Quick answers is the
  // second tab, for a question that does not need to wait for him.
  const [mode, setMode] = useState<"kyle" | "ask">("kyle");
  const asking = assistant && mode === "ask";

  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // A link followed from inside a message goes somewhere else; the panel should
  // not follow it there.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    // Read after every other listener has had the key: an Escape that closed
    // the search box or an open image was theirs, and the panel stays.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setTimeout(() => {
        if (!e.defaultPrevented) close();
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Full screen on a phone: the page behind should not scroll under a finger.
  useEffect(() => {
    if (!open) return;
    const small = window.matchMedia("(max-width: 639px)");
    if (!small.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Focus moves into the panel on open and back to the bubble on close, so a
  // keyboard user is never left on a control that just disappeared.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      closeRef.current?.focus({ preventScroll: true });
    } else if (wasOpen.current) {
      wasOpen.current = false;
      launcherRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label={asking ? "Quick answers" : "Chat with our team"}
          className={cn(
            "no-print fixed z-[45] flex flex-col overflow-hidden bg-pulse-surface",
            // phone: the whole screen, inside the notch and the home bar
            "inset-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            // from sm up: a panel above the bubble
            "sm:inset-auto sm:right-4 sm:w-[380px] sm:rounded-2xl sm:border sm:border-pulse-border sm:pt-0 sm:pb-0 sm:shadow-[0_24px_60px_rgba(0,0,0,0.45)]",
            // the tab bar still shows until lg, with the bubble above it
            "sm:bottom-[calc(9.75rem+env(safe-area-inset-bottom))] sm:h-[min(600px,calc(100dvh-11.5rem-env(safe-area-inset-bottom)))]",
            "lg:right-6 lg:bottom-24 lg:h-[min(600px,calc(100dvh-8rem))]",
          )}
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-pulse-border bg-[linear-gradient(135deg,color-mix(in_srgb,var(--pulse-gold)_22%,var(--pulse-surface))_0%,var(--pulse-surface)_100%)] px-4 py-3.5">
            {asking ? (
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pulse-gold/20 text-pulse-gold"
              >
                <Sparkles size={18} />
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- a 2 KB local logo; next/image buys nothing here
              <img src="/images/hd-logo-sm.webp" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-pulse-text">
                {asking ? "Quick answers" : HARTWELL.name}
              </p>
              <p className="truncate text-xs text-pulse-text-dim">
                {asking ? "An assistant. Our team sees every question" : "Messages go straight to our team"}
              </p>
            </div>
            <Link
              href="/messages"
              aria-label="Open the full Messages page"
              title="Open in Messages"
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-dim transition-colors hover:bg-pulse-surface-2 hover:text-pulse-text sm:flex"
            >
              <Maximize2 size={17} />
            </Link>
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="Close chat"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-dim transition-colors hover:bg-pulse-surface-2 hover:text-pulse-text"
            >
              <X size={21} />
            </button>
          </div>

          {assistant && (
            <div role="tablist" aria-label="Who to ask" className="grid shrink-0 grid-cols-2 border-b border-pulse-border">
              {(
                [
                  ["kyle", "Message our team"],
                  ["ask", "Quick answers"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  onClick={() => setMode(key)}
                  className={cn(
                    "h-10 border-b-2 text-[12px] font-bold tracking-[0.12em] uppercase transition-colors",
                    mode === key ? "border-pulse-gold text-pulse-text" : "border-transparent text-pulse-text-mute hover:text-pulse-text",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {!asking && conversations.length > 1 && (
            <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-pulse-border px-3 py-2">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  aria-pressed={active?.id === c.id}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors",
                    active?.id === c.id
                      ? "border-pulse-gold/50 bg-pulse-gold/10 text-pulse-text"
                      : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text",
                  )}
                >
                  {c.kind === "group" ? (
                    <Users size={13} strokeWidth={1.75} />
                  ) : (
                    <MessageSquare size={13} strokeWidth={1.75} />
                  )}
                  {c.label}
                </button>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {asking ? (
              <AssistantThread onMessageKyle={() => setMode("kyle")} />
            ) : active ? (
              <ChatThread
                key={active.id}
                conversationId={active.id}
                clientId={clientId}
                kind={active.kind}
                role="client"
                peerName={active.kind === "group" ? active.label : "our team"}
                staffNames={staffNames}
                fill
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <p className="text-sm text-pulse-text">
                  Our team will open your chat shortly.
                </p>
                <p className="mt-2 text-sm text-pulse-text-dim">
                  In the meantime you can email{" "}
                  <a
                    href={`mailto:${HARTWELL.email}`}
                    className="text-pulse-gold underline-offset-2 hover:underline"
                  >
                    {HARTWELL.email}
                  </a>
                  .
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : "Message our team"}
        aria-expanded={open}
        className={cn(
          "no-print fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-pulse-gold text-pulse-bg shadow-[0_10px_30px_rgba(0,0,0,0.35),0_0_0_6px_color-mix(in_srgb,var(--pulse-gold)_14%,transparent)] transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pulse-gold motion-reduce:transition-none motion-reduce:hover:scale-100 lg:right-6 lg:bottom-6",
          // On a phone the open panel covers the bubble; its own close button
          // does the job, and a second floating one would sit on the composer.
          open && "max-sm:hidden",
        )}
      >
        {open ? (
          <X size={24} strokeWidth={2} />
        ) : (
          <MessageCircle size={26} strokeWidth={1.9} />
        )}
        {!open && (
          <span className="pointer-events-none absolute -right-0.5 -top-0.5">
            <UnreadMessagesBadge bubble />
          </span>
        )}
      </button>
    </>
  );
}
