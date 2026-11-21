"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { approveMessage, dontSend, markChecked } from "@/app/admin/outreach/sender-actions";
import { FAULT_LABEL } from "@/lib/outreach/rules";
import type { QueueRow } from "@/components/outreach/QueueList";
import { cn } from "@/lib/utils/cn";

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(" ", "").toLowerCase();
const dayOf = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/**
 * Today, grouped the way Kyle thinks about it (Stage 8): what's going out
 * today and when, what went, what Pulse is still checking, and what's coming
 * up. Each row opens to the email itself; Don't send, Approve and Checked sit
 * on the row.
 */
export function TodayPanel({ rows, today }: { rows: QueueRow[]; today: string }) {
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

  const going = rows
    .filter((r) => (r.status === "queued" || r.status === "sending") && r.send_on === today && r.scheduled_for)
    .sort((a, b) => (a.scheduled_for! < b.scheduled_for! ? -1 : 1));
  const sent = rows.filter((r) => r.status === "sent").sort((a, b) => ((a.sent_at ?? "") < (b.sent_at ?? "") ? -1 : 1));
  const checking = rows.filter((r) => r.status === "awaiting_confirmation" && r.kind === "first");
  const later = rows
    // A follow-up with no day yet is waiting on its first email: not news.
    .filter((r) => r.status === "queued" && !(r.send_on === today && r.scheduled_for) && !(r.kind === "follow_up" && !r.send_on))
    .sort((a, b) => ((a.send_on ?? "9") < (b.send_on ?? "9") ? -1 : 1));

  const section = (title: string, note: string, list: QueueRow[], left: (r: QueueRow) => string) =>
    list.length > 0 && (
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h3 className="card-title">{title}</h3>
          <p className="text-[12px] text-pulse-text-mute">{note}</p>
        </div>
        <div className="divide-y divide-pulse-border overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
          {list.map((r) => {
            const live = r.status === "queued" || r.status === "awaiting_confirmation";
            const isOpen = open === r.id;
            return (
              <div key={r.id} className={cn(r.past_twelve && !r.checked_at && live && "bg-pulse-warn/5")}>
                <div className="flex items-start gap-3 px-4 py-3">
                  <p className="data-mono w-[64px] shrink-0 pt-0.5 text-[13px] text-pulse-text-dim">{left(r)}</p>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                    <p className="flex items-center gap-1.5 text-[15px] text-pulse-text">
                      <span className="truncate">{r.business}</span>
                      <ChevronDown size={14} className={cn("shrink-0 text-pulse-text-mute transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                    </p>
                    <p className="truncate text-[12px] text-pulse-text-mute">
                      {r.kind === "first" ? "First email" : "Follow-up"} · {FAULT_LABEL[r.fault]}
                      {r.test_mode && r.sent_to ? ` · to ${r.sent_to} (test)` : ""}
                      {r.needs_approval && !r.approved_at ? " · needs your approval" : ""}
                      {r.past_twelve ? (r.checked_at ? " · checked" : " · check this one") : ""}
                    </p>
                  </button>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {live && r.needs_approval && !r.approved_at && (
                      <Button type="button" size="sm" disabled={pending} onClick={() => act(() => approveMessage(r.id))}>
                        Approve
                      </Button>
                    )}
                    {r.past_twelve && !r.checked_at && live && (
                      <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => act(() => markChecked(r.id))}>
                        Checked
                      </Button>
                    )}
                    {live && (
                      <Button type="button" size="sm" variant="danger" disabled={pending} onClick={() => act(() => dontSend(r.id))}>
                        Don&apos;t send
                      </Button>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-pulse-border bg-pulse-surface-2/40 px-4 py-3">
                    <p className="text-[13px] text-pulse-text">{r.subject}</p>
                    <pre className="mt-2 font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text-dim">{r.body}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );

  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface px-4 py-8 text-center">
        <p className="text-[15px] text-pulse-text">Nothing waiting.</p>
        <p className="mt-1 text-[13px] text-pulse-text-mute">The morning run fills tomorrow's queue at 5:30am.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {section("Going out today", going.length ? `${going.length} to go` : "", going, (r) => time(r.scheduled_for!))}
      {section("Sent today", `${sent.length}`, sent, (r) => (r.sent_at ? time(r.sent_at) : ""))}
      {section("Being checked", "Pulse measures each fault again an hour on", checking, () => "Check")}
      {section("Coming up", "", later, (r) => (r.send_on ? dayOf(r.send_on).split(" ")[0] : "Next"))}
      {err && <p className="text-[13px] text-pulse-danger">{err}</p>}
    </div>
  );
}
