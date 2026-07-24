"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSupabaseClient } from "@/lib/supabase/client";

/**
 * Unread-message count for the Messages nav item. Counts real unread messages
 * (per-thread last_read_at, via the unread_message_counts RPC), not bell
 * notifications, so it clears the moment the thread is actually read and never
 * counts a teammate's private thread. Realtime pushes it up instantly; a poll
 * reconciles throttled tabs.
 */
export function UnreadMessagesBadge({ dot = false }: { dot?: boolean }) {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.rpc("unread_message_counts");
    const rows =
      (data as { conversation_id: string; unread: number }[] | null) ?? [];
    setCount(rows.reduce((sum, r) => sum + Number(r.unread), 0));
  }, [supabase, userId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // New message in any visible thread bumps the badge; reading a thread (own
  // last_read_at update, even from another tab) drops it.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`pulse-unread-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: `clerk_user_id=eq.${userId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId, load]);

  if (count === 0) return null;

  if (dot) {
    return (
      <span
        aria-label={`${count} unread message${count === 1 ? "" : "s"}`}
        className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-pulse-gold"
      />
    );
  }

  return (
    <span
      aria-label={`${count} unread message${count === 1 ? "" : "s"}`}
      className="data-mono ml-auto rounded-full bg-pulse-gold px-1.5 py-0.5 text-[10px] font-semibold leading-none text-pulse-bg"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
