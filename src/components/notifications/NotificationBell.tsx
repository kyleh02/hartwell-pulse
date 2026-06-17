"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Bell } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { Notification } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

// The "Gentle chime" — a soft two-note rise, synthesised so there's no audio
// asset to load. Kept deliberately quiet so it's pleasant, not naggy, for clients.
function playGentleChime(ctx: AudioContext) {
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const tone = (freq: number, start: number, dur: number, peak: number) => {
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };
  tone(587.33, 0, 0.9, 0.18);
  tone(880, 0.12, 0.95, 0.16);
}

export function NotificationBell() {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const ref = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const [soundOn, setSoundOn] = useState(true);
  const soundOnRef = useRef(true);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("recipient_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!active) return;
      const fresh = (data as Notification[] | null) ?? [];
      // Newly arrived, still-unread notifications since the last poll. The first
      // poll only seeds the baseline so we don't react to the existing backlog.
      const newOnes = fresh.filter(
        (n) => !n.read_at && !seenRef.current.has(n.id),
      );
      if (initializedRef.current && newOnes.length > 0) {
        // Soft chime for any new notification.
        if (soundOnRef.current && typeof window !== "undefined") {
          try {
            if (!audioRef.current) audioRef.current = new window.AudioContext();
            playGentleChime(audioRef.current);
          } catch {
            // audio unavailable / blocked — stay silent
          }
        }
        // Desktop pop-up specifically for new messages.
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          window.Notification.permission === "granted"
        ) {
          for (const n of newOnes) {
            if (n.type !== "message") continue;
            try {
              const dn = new window.Notification(n.title, {
                body: n.body ?? undefined,
                tag: n.id,
              });
              dn.onclick = () => {
                window.focus();
                if (n.link) window.location.href = n.link;
                dn.close();
              };
            } catch {
              // some platforms throw on construction; ignore
            }
          }
        }
      }
      for (const n of fresh) seenRef.current.add(n.id);
      initializedRef.current = true;
      setItems(fresh);
    };
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [supabase, userId]);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPerm("unsupported");
    } else {
      setPerm(window.Notification.permission);
    }
  }, []);

  // Load the saved sound preference, and unlock the audio context on the first
  // user gesture (browsers block audio until the user has interacted).
  useEffect(() => {
    try {
      if (localStorage.getItem("pulse-sound") === "off") setSoundOn(false);
    } catch {
      // ignore
    }
    const unlock = () => {
      try {
        if (!audioRef.current) audioRef.current = new window.AudioContext();
        void audioRef.current.resume().catch(() => {});
      } catch {
        // ignore
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  function toggleSound() {
    setSoundOn((on) => {
      const next = !on;
      try {
        localStorage.setItem("pulse-sound", next ? "on" : "off");
      } catch {
        // ignore
      }
      // Play a quick preview when switching on (this click also unlocks audio).
      if (next && typeof window !== "undefined") {
        try {
          if (!audioRef.current) audioRef.current = new window.AudioContext();
          playGentleChime(audioRef.current);
        } catch {
          // ignore
        }
      }
      return next;
    });
  }

  async function enableDesktop() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      setPerm(await window.Notification.requestPermission());
    } catch {
      // ignore
    }
  }

  const unread = items.filter((i) => !i.read_at).length;
  const now = () => new Date().toISOString();

  async function markAllRead() {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (ids.length === 0) return;
    setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at ?? now() })));
    await supabase.from("notifications").update({ read_at: now() }).in("id", ids);
  }

  async function openItem(n: Notification) {
    if (!n.read_at) {
      setItems((prev) =>
        prev.map((i) => (i.id === n.id ? { ...i, read_at: now() } : i)),
      );
      await supabase.from("notifications").update({ read_at: now() }).eq("id", n.id);
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-dim transition-colors hover:bg-pulse-surface-2 hover:text-pulse-text"
      >
        <Bell size={18} strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-pulse-gold px-1 text-[9px] font-semibold text-pulse-bg">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-pulse-border px-3 py-2">
            <span className="mono-label">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] text-pulse-gold hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-pulse-text-mute">
                Nothing here yet.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b border-pulse-border px-3 py-2.5 text-left transition-colors hover:bg-pulse-surface-2",
                    !n.read_at && "bg-pulse-gold/5",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {!n.read_at && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pulse-gold" />
                    )}
                    <span className="flex-1 truncate text-sm text-pulse-text">
                      {n.title}
                    </span>
                  </div>
                  {n.body && (
                    <span className="truncate text-xs text-pulse-text-dim">
                      {n.body}
                    </span>
                  )}
                  <span className="data-mono text-[10px] text-pulse-text-mute">
                    {new Date(n.created_at).toLocaleString("en-AU", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="flex items-center justify-between border-t border-pulse-border px-3 py-2">
            <span className="text-[11px] text-pulse-text-mute">
              Notification sound
            </span>
            <button
              type="button"
              onClick={toggleSound}
              className="text-[11px] text-pulse-gold hover:underline"
            >
              {soundOn ? "On" : "Off"}
            </button>
          </div>
          {perm !== "unsupported" && (
            <div className="border-t border-pulse-border px-3 py-2">
              {perm === "granted" ? (
                <p className="text-[11px] text-pulse-text-mute">
                  Desktop alerts are on for new messages.
                </p>
              ) : perm === "denied" ? (
                <p className="text-[11px] text-pulse-text-mute">
                  Desktop alerts are blocked in your browser settings.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={enableDesktop}
                  className="text-[11px] text-pulse-gold hover:underline"
                >
                  Enable desktop alerts for new messages
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
