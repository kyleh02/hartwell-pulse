"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import {
  savePushSubscription,
  removePushSubscription,
  sendTestPush,
} from "@/lib/actions/push";
import { cn } from "@/lib/utils/cn";

type State = "loading" | "unsupported" | "ios-needs-install" | "off" | "on" | "blocked";

/**
 * VAPID public keys travel as base64url; PushManager wants a Uint8Array backed
 * by a real ArrayBuffer (the return type is inferred on purpose — annotating it
 * as plain Uint8Array widens the buffer to ArrayBufferLike, which no longer
 * satisfies BufferSource).
 */
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * Per-device push opt-in. Subscriptions are device-scoped by design, so Kyle
 * can have his phone buzzing while his desktop stays quiet.
 */
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      // Safari on iOS only exposes push once the site is a Home Screen app.
      setState(
        typeof navigator !== "undefined" && isIos() && !isStandalone()
          ? "ios-needs-install"
          : "unsupported",
      );
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setState(sub ? "on" : "off");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function enable() {
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        setNote("Push isn't configured on the server yet.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      await savePushSubscription({
        endpoint: json.endpoint ?? "",
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent,
      });
      setState("on");
      setNote("Notifications are on for this device.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setNote("Notifications are off for this device.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const { sent } = await sendTestPush();
      setNote(
        sent > 0
          ? "Sent — check your device."
          : "No devices are registered for push yet.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;

  if (state === "ios-needs-install") {
    return (
      <Hint>
        To get notifications on iPhone, tap Share then Add to Home Screen, and
        open Pulse from there.
      </Hint>
    );
  }
  if (state === "unsupported") {
    return <Hint>This browser can&apos;t do notifications.</Hint>;
  }
  if (state === "blocked") {
    return (
      <Hint>
        Notifications are blocked for this site. Turn them back on in your
        browser settings, then reload.
      </Hint>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void (state === "on" ? disable() : enable())}
        disabled={busy}
        className={cn(
          "flex items-center gap-2 rounded-[var(--radius-input)] border px-3 py-1.5 text-sm transition-colors disabled:opacity-60",
          state === "on"
            ? "border-pulse-gold/50 bg-pulse-gold/10 text-pulse-text"
            : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text",
        )}
      >
        {state === "on" ? <BellRing size={14} /> : <BellOff size={14} />}
        {state === "on" ? "Notifications on" : "Turn on notifications"}
      </button>
      {state === "on" && (
        <button
          type="button"
          onClick={() => void test()}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs text-pulse-text-mute hover:text-pulse-text disabled:opacity-60"
        >
          <Bell size={12} /> Send a test
        </button>
      )}
      {note && <span className="text-xs text-pulse-text-mute">{note}</span>}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-pulse-text-mute">{children}</p>;
}
