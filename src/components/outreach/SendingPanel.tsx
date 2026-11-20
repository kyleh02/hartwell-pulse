"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/Button";
import { disconnectGmailAction, sendTestPair, setPaused } from "@/app/admin/outreach/sender-actions";
import { cn } from "@/lib/utils/cn";

export interface SendingProps {
  gmail: { email: string; connected_at: string } | null;
  setupMissing: string[];
  paused: boolean;
  pausedReason: string | null;
  tickAt: string | null;
  tickNote: string | null;
  mode: string;
  holidays: string;
  flash: { outcome: string; why: string | null } | null;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Gmail, pause all, the tick's last word, and a test pair to the test inbox. */
export function SendingPanel(p: SendingProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    p.flash
      ? p.flash.outcome === "connected"
        ? { ok: true, text: "Gmail connected." }
        : p.flash.outcome === "setup"
          ? { ok: false, text: "Google's client id and secret aren't in Vercel yet." }
          : { ok: false, text: p.flash.why ?? "Connecting Gmail didn't work." }
      : null,
  );

  const run = (fn: () => Promise<{ ok: boolean; message?: string; to?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.to ? `${done} ${r.to}.` : done } : { ok: false, text: r.message ?? "That didn't work." });
      router.refresh();
    });

  const stale = !p.tickAt || Date.now() - new Date(p.tickAt).getTime() > 20 * 60_000;

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-input)] border border-pulse-border p-3">
        <div className="min-w-0">
          <p className="text-pulse-text">{p.gmail ? `Gmail: ${p.gmail.email}` : "Gmail isn't connected"}</p>
          <p className="text-[12px] text-pulse-text-mute">
            {p.gmail ? `Connected ${when(p.gmail.connected_at)}` : "Sign in as kyle@hartwelldigital.com and allow sending and reading Draper's own threads."}
          </p>
        </div>
        {p.gmail ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => run(sendTestPair, "Test pair sent to")}>
              Send a test pair
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => run(disconnectGmailAction, "Gmail disconnected.")}>
              Disconnect
            </Button>
          </div>
        ) : p.setupMissing.length ? (
          <p className="text-[12px] text-pulse-warn">Needs {p.setupMissing.join(", ")} in Vercel first.</p>
        ) : (
          <a href="/api/outreach/gmail/connect" className={buttonClasses("primary")}>
            Connect Gmail
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-input)] border border-pulse-border p-3">
        <div className="min-w-0">
          <p className={cn(p.paused ? "text-pulse-warn" : "text-pulse-text")}>{p.paused ? `Paused: ${p.pausedReason ?? "everything is held"}` : p.mode}</p>
          <p className={cn("text-[12px]", stale ? "text-pulse-warn" : "text-pulse-text-mute")}>
            {p.tickAt ? `Last tick ${when(p.tickAt)}: ${p.tickNote ?? ""}` : "The tick hasn't run yet: add the cron-job.org job."}
            {p.tickAt && stale ? " (over 20 minutes ago: check the cron-job.org job)" : ""}
          </p>
          <p className="text-[12px] text-pulse-text-mute">Public holidays: {p.holidays}</p>
        </div>
        <Button type="button" variant={p.paused ? "primary" : "danger"} disabled={pending} onClick={() => run(() => setPaused(!p.paused), p.paused ? "Sending resumed." : "Everything paused.")}>
          {p.paused ? "Resume" : "Pause all"}
        </Button>
      </div>

      {msg && <p className={msg.ok ? "text-pulse-success" : "text-pulse-danger"}>{msg.text}</p>}
    </div>
  );
}
