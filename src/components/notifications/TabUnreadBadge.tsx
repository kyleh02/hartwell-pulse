"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useSupabaseClient } from "@/lib/supabase/client";

const BASE_TITLE = "Hartwell Pulse";

/** Composite the original favicon + a red unread badge onto a 32x32 canvas. */
function drawBadgedFavicon(
  href: string | null,
  count: number,
  done: (dataUrl: string) => void,
) {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const paint = () => {
    const r = size * 0.34;
    const cx = size - r;
    const cy = r;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fillStyle = "#b5563f"; // pulse danger
    ctx.fill();
    const label = count > 9 ? "9+" : String(count);
    ctx.font = `bold ${label.length > 1 ? 13 : 18}px Arial, sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy + 1);
    done(canvas.toDataURL("image/png"));
  };

  if (href) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      paint();
    };
    img.onerror = paint; // just the dot on a blank canvas if the icon won't load
    img.src = href;
  } else {
    paint();
  }
}

/**
 * Drives the browser-tab unread indicator: a "(n)" prefix in the title (works
 * everywhere incl. Safari) and a dynamic favicon dot (Chrome/Firefox/Edge). Reads
 * the same unread notifications the bell shows; clears the moment they're read.
 * Renders nothing. Mount once in the app shell.
 */
export function TabUnreadBadge() {
  const supabase = useSupabaseClient();
  const { userId } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const unreadRef = useRef(0);
  const originalHref = useRef<string | null>(null);
  const linkRef = useRef<HTMLLinkElement | null>(null);

  // Resolve + cache the favicon <link> once (Next.js App Router injects its own).
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    linkRef.current = link;
    if (originalHref.current === null) originalHref.current = link.href;
  }, []);

  // Poll the unread count (a tab badge doesn't need sub-second freshness), and
  // re-check whenever the tab regains focus so it clears promptly after reading.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const load = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", userId)
        .is("read_at", null);
      if (active) setUnread(count ?? 0);
    };
    void load();
    const t = setInterval(() => void load(), 15000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [supabase, userId]);

  // Reflect unread into the tab title + favicon. Re-applies on route change so
  // Next.js re-rendering <title> from metadata can't wipe the prefix.
  useEffect(() => {
    unreadRef.current = unread;
    document.title =
      unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${BASE_TITLE}` : BASE_TITLE;

    const link = linkRef.current;
    if (link) {
      if (unread <= 0) {
        if (originalHref.current) link.href = originalHref.current;
      } else {
        drawBadgedFavicon(originalHref.current, unread, (dataUrl) => {
          if (unreadRef.current > 0) link.href = dataUrl;
        });
      }
    }

    // Best effort — only does anything if Pulse is installed as a PWA.
    const nav = navigator as unknown as {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (unread > 0) nav.setAppBadge?.(unread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unread, pathname]);

  return null;
}
