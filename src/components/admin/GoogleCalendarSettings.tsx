"use client";

import { useState, useTransition } from "react";
import { disconnectGoogleCalendar, syncCalendarNow } from "@/app/admin/calendar/actions";
import { Button, buttonClasses } from "@/components/ui/Button";

type Conn = { email: string; connected_at: string; last_sync_at: string | null; last_sync_error: string | null };

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Google Calendar: connect admin@'s calendar, see the last sync, sync now or disconnect. */
export function GoogleCalendarSettings({ connection, outcome }: { connection: Conn | null | "no-table"; outcome: { kind: string; why: string | null } | null }) {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(
    outcome?.kind === "connected"
      ? { ok: true, text: "Connected. Your invoices, follow-ups and dated to-dos are on their way to your calendar." }
      : outcome?.kind === "error"
        ? { ok: false, text: outcome.why ?? "Google didn't connect." }
        : null,
  );
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, okText?: string) =>
    start(async () => {
      const r = await fn();
      setNote(r.ok ? { ok: true, text: r.message ?? okText ?? "Done." } : { ok: false, text: r.message ?? "That didn't work." });
    });

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-pulse-text">Google Calendar</h2>
        {connection && connection !== "no-table" && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => run(syncCalendarNow)} disabled={pending}>
              {pending ? "Working…" : "Sync now"}
            </Button>
            <Button size="sm" variant="danger" onClick={() => run(disconnectGoogleCalendar, "Disconnected. Events already in Google stay there.")} disabled={pending}>
              Disconnect
            </Button>
          </div>
        )}
      </div>
      <div className="grid gap-3 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4 text-sm leading-relaxed text-pulse-text-dim">
        {connection === "no-table" ? (
          <p>Run migration 0070 in the Supabase SQL Editor first, then connect here.</p>
        ) : connection ? (
          <>
            <p>
              <span className="font-semibold text-pulse-text">Connected to {connection.email}.</span> The Calendar page shows your events and adds new
              ones. Sent invoices&apos; due dates, lead follow-ups and dated to-dos go on your calendar by themselves, and update or come off when they
              change, are paid or are done. Every 15 minutes, or now with Sync now.
            </p>
            <p className="text-xs text-pulse-text-mute">
              Connected {when(connection.connected_at)}
              {connection.last_sync_at ? ` · last synced ${when(connection.last_sync_at)}` : ""}
            </p>
            {connection.last_sync_error && <p className="text-xs text-pulse-danger">Last sync: {connection.last_sync_error}</p>}
          </>
        ) : (
          <>
            <p>
              Connect <span className="font-semibold text-pulse-text">admin@hartwelldigital.com</span>&apos;s Google Calendar to see it in the portal,
              add events from here, and have invoices&apos; due dates, lead follow-ups and dated to-dos appear on it.
            </p>
            <div>
              <a href="/api/google-calendar/connect" className={buttonClasses("primary", "sm")}>
                Connect Google Calendar
              </a>
            </div>
          </>
        )}
        {note && <p className={note.ok ? "text-xs text-pulse-success" : "text-xs text-pulse-danger"}>{note.text}</p>}
      </div>
    </section>
  );
}
