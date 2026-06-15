"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Bell } from "lucide-react";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { Notification } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

export function NotificationBell() {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
      if (active) setItems((data as Notification[] | null) ?? []);
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
        </div>
      )}
    </div>
  );
}
