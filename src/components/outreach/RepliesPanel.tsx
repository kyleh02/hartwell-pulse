"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { faultOn, labelReply, laterDone } from "@/app/admin/outreach/reply-actions";
import { LABEL_TEXT, REPLY_LABELS, type ReplyLabel } from "@/lib/outreach/replies-rules";
import { FAULT_LABEL, type Fault } from "@/lib/outreach/rules";
import { cn } from "@/lib/utils/cn";

export interface ReplyRow {
  id: string;
  business: string;
  kind: "reply" | "bounce" | "auto_reply" | "opt_out";
  quote: string | null;
  label: ReplyLabel | null;
  later_on: string | null;
  received_at: string;
  test: boolean;
  thread_url: string | null;
  lead_id: string | null;
}

export interface LaterRow {
  prospect_id: string;
  business: string;
  later_on: string;
  due: boolean;
  thread_url: string | null;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** Labels that close a business for good ask first: a mistap on a phone shouldn't do that. */
const ASK: Partial<Record<ReplyLabel, string>> = {
  no_thanks: "No thanks: closed, and on do-not-contact for good. Carry on?",
  complaint: "Complaint: closed, on do-not-contact, and Draper pauses everything. Carry on?",
  wrong_fact: "Wrong fact: closed. Two of these switch that fault off. Carry on?",
};

const KIND_TEXT: Record<ReplyRow["kind"], string> = { reply: "Reply", bounce: "Bounced", auto_reply: "Automatic", opt_out: "Opted out" };

/**
 * Replies (Stage 6): what's waiting for a label, the "later" cards, faults
 * the wrong-fact rule switched off, and the last fortnight's replies. Kyle
 * answers every reply himself in kyle@'s Gmail; this only records what it was.
 */
export function RepliesPanel({ needs, recent, later, faultsOff }: { needs: ReplyRow[]; recent: ReplyRow[]; later: LaterRow[]; faultsOff: Fault[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [laterFor, setLaterFor] = useState<string | null>(null);
  const [laterDate, setLaterDate] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; message?: string; leadId?: string | null }>, done: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.leadId ? `${done} It's in the pipeline, due today.` : done } : { ok: false, text: r.message ?? "That didn't work." });
      if (r.ok) setLaterFor(null);
      router.refresh();
    });

  const label = (r: ReplyRow, l: ReplyLabel) => {
    if (l === "later") {
      setLaterFor(laterFor === r.id ? null : r.id);
      return;
    }
    if (ASK[l] && !window.confirm(ASK[l])) return;
    act(() => labelReply(r.id, l, null), `Labelled ${LABEL_TEXT[l].toLowerCase()}.`);
  };

  const dueLater = later.filter((l) => l.due);

  return (
    <div className="space-y-4 text-[13px]">
      {faultsOff.length > 0 && (
        <div className="rounded-[var(--radius-input)] border border-pulse-warn/50 p-3">
          <p className="text-pulse-warn">Switched off after two &quot;wrong fact&quot; replies. No new email will claim these:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {faultsOff.map((f) => (
              <Button key={f} type="button" size="sm" variant="secondary" disabled={pending} onClick={() => act(() => faultOn(f), `${FAULT_LABEL[f]} is back on.`)}>
                {FAULT_LABEL[f]}: switch back on
              </Button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-pulse-text">
          {needs.length ? `${needs.length} waiting for a label` : "Nothing waiting for a label."}
          <span className="text-pulse-text-mute"> Answer each one yourself in kyle@&apos;s Gmail, then label it here.</span>
        </p>
        <div className="space-y-2">
          {needs.map((r) => (
            <div key={r.id} className="rounded-[var(--radius-input)] border border-pulse-gold/40 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-pulse-text">
                  {r.test && <span className="text-pulse-warn">[Test] </span>}
                  {r.business}
                </p>
                <p className="text-[12px] text-pulse-text-mute">{when(r.received_at)}</p>
              </div>
              <pre className="mt-2 max-h-48 overflow-y-auto font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text-dim">{r.quote || "(no words)"}</pre>
              {r.thread_url && (
                <a href={r.thread_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-pulse-gold underline underline-offset-2">
                  Open the thread in Gmail
                </a>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REPLY_LABELS.map((l) => (
                  <Button
                    key={l}
                    type="button"
                    size="sm"
                    variant={l === "interested" || l === "question" ? "primary" : l === "complaint" ? "danger" : "secondary"}
                    disabled={pending}
                    onClick={() => label(r, l)}
                  >
                    {LABEL_TEXT[l]}
                  </Button>
                ))}
              </div>
              {laterFor === r.id && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="block">
                    <span className="text-[12px] text-pulse-text-mute">Bring the card back on</span>
                    <input
                      type="date"
                      className="mt-0.5 block rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-sm text-pulse-text"
                      value={laterDate}
                      onChange={(e) => setLaterDate(e.target.value)}
                    />
                  </label>
                  <Button type="button" size="sm" disabled={pending || !laterDate} onClick={() => act(() => labelReply(r.id, "later", laterDate), `Back on ${day(laterDate)}.`)}>
                    Save
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {later.length > 0 && (
        <div>
          <p className="mb-2 text-pulse-text">
            Later{dueLater.length ? <span className="text-pulse-warn"> · {dueLater.length} due</span> : null}
          </p>
          <div className="space-y-1.5">
            {later.map((l) => (
              <div key={l.prospect_id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-input)] border p-2.5", l.due ? "border-pulse-warn/50" : "border-pulse-border")}>
                <p className="min-w-0">
                  <span className="text-pulse-text">{l.business}</span>
                  <span className={l.due ? "text-pulse-warn" : "text-pulse-text-mute"}> · {l.due ? "due" : "back"} {day(l.later_on)}</span>
                  {l.thread_url && (
                    <a href={l.thread_url} target="_blank" rel="noreferrer" className="ml-2 text-[12px] text-pulse-gold underline underline-offset-2">
                      Thread
                    </a>
                  )}
                </p>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act(() => laterDone(l.prospect_id), "Card closed.")}>
                  Done
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <p className="mb-2 text-pulse-text">The last fortnight</p>
          <div className="divide-y divide-pulse-border rounded-[var(--radius-input)] border border-pulse-border">
            {recent.map((r) => (
              <div key={r.id} className="p-2.5">
                <button type="button" className="w-full text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="text-pulse-text">
                    {r.test && <span className="text-pulse-warn">[Test] </span>}
                    {r.business}
                  </span>
                  <span className="text-pulse-text-mute">
                    {" "}
                    · {r.label ? LABEL_TEXT[r.label] : KIND_TEXT[r.kind]}
                    {r.label === "later" && r.later_on ? ` (${day(r.later_on)})` : ""} · {when(r.received_at)}
                  </span>
                </button>
                {r.lead_id && (
                  <Link href={`/admin/pipeline/${r.lead_id}`} className="ml-0 block text-[12px] text-pulse-gold underline underline-offset-2">
                    In the pipeline
                  </Link>
                )}
                {open === r.id && r.quote && (
                  <pre className="mt-1.5 font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text-dim">{r.quote}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {msg && <p className={msg.ok ? "text-pulse-success" : "text-pulse-danger"}>{msg.text}</p>}
    </div>
  );
}
