"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { approveMessage, dontSend, markChecked } from "@/app/admin/outreach/sender-actions";
import { FAULT_LABEL, type Fault } from "@/lib/outreach/rules";
import { cn } from "@/lib/utils/cn";

export interface QueueRow {
  id: string;
  business: string;
  kind: "first" | "follow_up";
  status: string;
  fault: Fault;
  subject: string;
  body: string;
  send_on: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  sent_to: string | null;
  test_mode: boolean | null;
  past_twelve: boolean;
  checked_at: string | null;
  needs_approval: boolean;
  approved_at: string | null;
}

const STATUS: Record<string, string> = {
  awaiting_confirmation: "Waiting for the hour-later check",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
};

const at = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * What's waiting and what went today, each with its email. "Don't send" stops
 * one (a first email takes its follow-up with it); "Approve" releases one a
 * lane holds; "Checked" ticks a "Check these" email after reading it.
 */
export function QueueList({ rows }: { rows: QueueRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setErr(r.ok ? null : (r.message ?? "That didn't work."));
      router.refresh();
    });

  if (rows.length === 0) return <p className="text-[13px] text-pulse-text-mute">Nothing waiting, and nothing sent today.</p>;
  const checkThese = rows.filter((r) => r.past_twelve && r.status !== "sent").length;

  return (
    <div className="space-y-2">
      {checkThese > 0 && <p className="text-[12px] text-pulse-warn">{checkThese} in Check these: past 12 today, sending from 12:30pm. Read and tick them.</p>}
      {rows.map((r) => {
        const live = r.status === "queued" || r.status === "awaiting_confirmation";
        return (
          <div key={r.id} className={cn("rounded-[var(--radius-input)] border p-3", r.past_twelve && !r.checked_at ? "border-pulse-warn/50" : "border-pulse-border")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button type="button" className="min-w-0 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <p className="text-sm text-pulse-text">
                  {r.business}
                  <span className="text-pulse-text-mute"> · {r.kind === "first" ? "first email" : "follow-up"}</span>
                </p>
                <p className="text-[12px] text-pulse-text-dim">
                  {r.subject} · {FAULT_LABEL[r.fault]}
                </p>
                <p className="text-[12px] text-pulse-text-mute">
                  {STATUS[r.status] ?? r.status}
                  {r.sent_at ? ` ${at(r.sent_at)}${r.test_mode ? ` to ${r.sent_to} (test)` : ""}` : r.scheduled_for ? `, ${at(r.scheduled_for)}` : r.send_on ? `, for ${r.send_on}` : ""}
                  {r.needs_approval && !r.approved_at ? " · needs your approval" : ""}
                  {r.past_twelve ? (r.checked_at ? " · checked" : " · check these") : ""}
                </p>
              </button>
              <div className="flex flex-wrap gap-1.5">
                {live && r.needs_approval && !r.approved_at && (
                  <Button type="button" variant="primary" disabled={pending} onClick={() => act(() => approveMessage(r.id))}>
                    Approve
                  </Button>
                )}
                {r.past_twelve && !r.checked_at && (
                  <Button type="button" variant="secondary" disabled={pending} onClick={() => act(() => markChecked(r.id))}>
                    Checked
                  </Button>
                )}
                {live && (
                  <Button type="button" variant="danger" disabled={pending} onClick={() => act(() => dontSend(r.id))}>
                    Don&apos;t send
                  </Button>
                )}
              </div>
            </div>
            {open === r.id && (
              <pre className="mt-2 font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text-dim">{r.body}</pre>
            )}
          </div>
        );
      })}
      {err && <p className="text-[13px] text-pulse-danger">{err}</p>}
    </div>
  );
}
