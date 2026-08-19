"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  Clock,
  Linkedin,
  ShieldAlert,
  FileEdit,
  ExternalLink,
} from "lucide-react";
import { setScheduled, draftNow, markSent } from "@/app/admin/crm/actions";
import { Reschedule } from "@/components/crm/Reschedule";
import { cn } from "@/lib/utils/cn";

interface Contact {
  first_name: string | null;
  surname: string | null;
  role_title: string | null;
  email_as_published: string | null;
  name_verified: string | null;
  fallback_greeting: string | null;
}

export interface PlanRow {
  id: string;
  legal_name: string;
  trading_name: string | null;
  state: string | null;
  domain: string | null;
  rank: number | null;
  priority_tier: number | null;
  channel: string | null;
  stage: string;
  scheduled_send_at: string | null;
  scheduled_at: string | null;
  followup_due: string | null;
  hook: string | null;
  hook_verified_at: string | null;
  hard_warning: string | null;
  send_approved_at: string | null;
  send_attempted_at: string | null;
  /**
   * The last outbound touch that was not a bounce, from the touch log.
   *
   * This is what "sent" means here, not `send_attempted_at`, which only
   * `markSent` ever writes. Computed on the plan page, so a row logged through
   * any path ticks off.
   */
  sent_at?: string | null;
  send_error: string | null;
  email_body: string | null;
  draft_created_at: string | null;
  graph_web_link: string | null;
  crm_contacts: Contact | Contact[] | null;
  contact?: Contact | null;
}

/** Australia/Brisbane, which is where Kyle works from. */
const TZ = "Australia/Brisbane";

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function timeOf(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString("en-AU", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
    })
    .toLowerCase();
}

function daysUntil(dateOnly: string): number {
  const then = new Date(`${dateOnly}T00:00:00+10:00`).getTime();
  const now = new Date().setHours(0, 0, 0, 0);
  return Math.round((then - now) / 86_400_000);
}

/**
 * A fault older than 14 days may not be quoted without re-verification.
 * Websites change, and the whole offer rests on the fault being real today.
 */
function hookIsStale(verifiedAt: string | null): boolean {
  if (!verifiedAt) return true;
  const age =
    (Date.now() - new Date(`${verifiedAt}T00:00:00+10:00`).getTime()) /
    86_400_000;
  return age > 14;
}

export function SendPlan({ rows }: { rows: PlanRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const [note, setNote] = useState<string | null>(null);

  function makeDraft(row: PlanRow) {
    setBusy(row.id);
    setNote(null);
    startTransition(async () => {
      const res = await draftNow(row.id);
      setBusy(null);
      if (!res.ok) setNote(res.message);
      else setNote(`Draft is in Outlook for ${row.legal_name}. Send it there, then mark it sent.`);
      router.refresh();
    });
  }

  function confirm(row: PlanRow) {
    if (
      !window.confirm(
        `Mark ${row.legal_name} as sent?

Only do this once the email has actually left Outlook. This writes the compliance record and starts the day 8 to 10 follow-up clock.`,
      )
    )
      return;
    setBusy(row.id);
    setNote(null);
    startTransition(async () => {
      const res = await markSent(row.id);
      setBusy(null);
      if (!res.ok) setNote(res.message);
      router.refresh();
    });
  }

  function toggleScheduled(row: PlanRow) {
    setBusy(row.id);
    startTransition(async () => {
      await setScheduled(row.id, !row.scheduled_at);
      setBusy(null);
      router.refresh();
    });
  }

  // ---- the day this is all organised around ----
  const todayKey = new Date().toLocaleDateString("en-AU", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // A scheduled follow-up belongs with the day it goes out, not in the list of
  // windows still waiting on an email. Three of the eighteen sends this week
  // are follow-ups and they were showing in the wrong place.
  const toSend = rows
    .filter(
      (r) =>
        r.scheduled_send_at && !r.sent_at,
    )
    .sort((a, b) => (a.scheduled_send_at! < b.scheduled_send_at! ? -1 : 1));
  const scheduled = new Set(toSend.map((r) => r.id));

  const followUps = rows
    .filter(
      (r) => r.stage === "contacted" && r.followup_due && !scheduled.has(r.id),
    )
    .sort((a, b) => (a.followup_due! < b.followup_due! ? -1 : 1));

  // Not sending by email. bounced is NOT here: a bounce means it never
  // arrived, so those go back in the queue as re-sends.
  const held = rows.filter((r) =>
    ["blocked", "linkedin_only", "email_closed"].includes(r.stage),
  );

  // Anything already out the door. Kept visible rather than filed away: seeing
  // what has gone is half of knowing what to do next.
  // A bounced record is not "sent". It was attempted and rejected, and it is
  // going out again, which is why sent_at excludes a bounced touch rather than
  // this filter having to know about stages.
  const sent = rows
    .filter((r) => r.sent_at)
    .sort((a, b) => (a.sent_at! > b.sent_at! ? -1 : 1));

  const failed = rows.filter((r) => r.send_error);

  const byDay = new Map<string, PlanRow[]>();
  for (const r of toSend) {
    const k = dayKey(r.scheduled_send_at!);
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }

  // Today's work is everything due today plus anything overdue, in one list,
  // because "what do I do now" is one question and should not be assembled
  // from three sections.
  const dueToday = [
    ...followUps.filter((r) => daysUntil(r.followup_due!) <= 0),
    ...(byDay.get(todayKey) ?? []),
  ];
  const laterDays = [...byDay.entries()].filter(([k]) => k !== todayKey);
  const laterFollowUps = followUps.filter((r) => daysUntil(r.followup_due!) > 0);

  return (
    <div className="space-y-8">
      {note && (
        <p className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface-2 px-4 py-3 text-sm text-pulse-text-dim">
          {note}
        </p>
      )}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-pulse-text">Today</h2>
          <span className="data-mono text-[11px] text-pulse-text-mute">
            {todayKey}
          </span>
        </div>
        {dueToday.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-pulse-border px-4 py-6 text-center text-sm text-pulse-text-mute">
            Nothing due today. The next one is below.
          </p>
        ) : (
          <div className="space-y-2">
            {dueToday.map((r) => {
              const overdue = r.followup_due && daysUntil(r.followup_due) < 0;
              return (
                <Row
                  key={r.id}
                  row={r}
                  tone={overdue ? "danger" : "warn"}
                  when={
                    r.followup_due
                      ? overdue
                        ? `follow-up ${Math.abs(daysUntil(r.followup_due))} day${Math.abs(daysUntil(r.followup_due)) === 1 ? "" : "s"} overdue`
                        : "follow-up due today"
                      : timeOf(r.scheduled_send_at!)
                  }
                  onSchedule={() => toggleScheduled(r)}
                  onDraft={() => makeDraft(r)}
                  onSent={() => confirm(r)}
                  busy={pending && busy === r.id}
                />
              );
            })}
          </div>
        )}
      </section>

      {failed.length > 0 && (
        <section>
          <h2 className="mono-label mb-3 text-pulse-danger">Did not send</h2>
          <div className="space-y-2">
            {failed.map((r) => (
              <Row
                key={r.id}
                row={r}
                tone="danger"
                when={r.send_error ?? "failed"}
                busy={false}
              />
            ))}
          </div>
        </section>
      )}

      {laterFollowUps.length > 0 && (
        <section>
          <h2 className="mono-label mb-3">Follow-ups coming up</h2>
          <div className="space-y-2">
            {laterFollowUps.map((r) => {
              const due = daysUntil(r.followup_due!);
              // Day 11 means the window is missed. Surface it rather than
              // silently sending late.
              const overdue = due < 0;
              const today = due === 0;
              return (
                <Row
                  key={r.id}
                  row={r}
                  tone={overdue ? "danger" : today ? "warn" : "quiet"}
                  when={
                    overdue
                      ? `${Math.abs(due)} day${Math.abs(due) === 1 ? "" : "s"} overdue`
                      : today
                        ? "due today"
                        : `due in ${due} day${due === 1 ? "" : "s"}`
                  }
                  onSchedule={() => toggleScheduled(r)}
                  onDraft={() => makeDraft(r)}
                  onSent={() => confirm(r)}
                  busy={pending && busy === r.id}
                />
              );
            })}
          </div>
        </section>
      )}

      {laterDays.map(([day, list]) => (
        <section key={day}>
          <h2 className="mono-label mb-3">{day}</h2>
          <div className="space-y-2">
            {list.map((r) => (
              <Row
                key={r.id}
                row={r}
                tone="quiet"
                when={timeOf(r.scheduled_send_at!)}
                onSchedule={() => toggleScheduled(r)}
                busy={pending && busy === r.id}
              />
            ))}
          </div>
        </section>
      ))}

      {sent.length > 0 && (
        <section>
          <h2 className="mono-label mb-3 text-pulse-success">Sent</h2>
          <div className="space-y-2">
            {sent.map((r) => (
              <Row
                key={r.id}
                row={r}
                tone="quiet"
                when={`sent ${new Date(r.sent_at!).toLocaleString("en-AU", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}
                busy={false}
              />
            ))}
          </div>
        </section>
      )}

      {held.length > 0 && (
        <section>
          <h2 className="mono-label mb-3">Not sending</h2>
          <div className="space-y-2">
            {held.map((r) => (
              <Row
                key={r.id}
                row={r}
                tone="quiet"
                when={
                  r.stage === "blocked"
                    ? "blocked"
                    : r.stage === "email_closed"
                      ? "email closed"
                      : "LinkedIn only"
                }
                busy={false}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Row({
  row,
  tone,
  when,
  onSchedule,
  onDraft,
  onSent,
  busy,
}: {
  row: PlanRow;
  tone: "quiet" | "warn" | "danger";
  when: string;
  onSchedule?: () => void;
  onDraft?: () => void;
  onSent?: () => void;
  busy: boolean;
}) {
  const c = row.contact ?? null;
  const name = [c?.first_name, c?.surname].filter(Boolean).join(" ");
  const stale = hookIsStale(row.hook_verified_at);
  const blocked = ["blocked", "linkedin_only", "email_closed"].includes(
    row.stage,
  );

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border bg-pulse-surface p-4",
        tone === "danger"
          ? "border-pulse-danger/40"
          : tone === "warn"
            ? "border-pulse-warn/40"
            : "border-pulse-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="data-mono text-[11px] text-pulse-text-mute">
              {row.rank}
            </span>
            <Link
              href={`/admin/crm/${row.id}`}
              className="font-medium text-pulse-text hover:text-pulse-gold"
            >
              {row.trading_name
                ? `${row.trading_name} (${row.legal_name})`
                : row.legal_name}
            </Link>
            <span className="data-mono text-[11px] text-pulse-text-mute">
              tier {row.priority_tier} · {row.channel} · {row.state}
            </span>
          </div>

          {row.hook && (
            <p className="mt-1.5 text-sm text-pulse-text-dim">{row.hook}</p>
          )}

          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-pulse-text-mute">
            <span className="data-mono">{c?.email_as_published}</span>
            {name && (
              <span>
                {name}
                {c?.role_title ? `, ${c.role_title}` : ""}
              </span>
            )}
            {/* A directory name has never been confirmed by the company. Ten
                seconds on LinkedIn, or use the fallback greeting. */}
            {c?.name_verified === "directory" && (
              <span className="inline-flex items-center gap-1 text-pulse-warn">
                <AlertTriangle size={11} /> verify the name
                {c.fallback_greeting ? ` or open "${c.fallback_greeting}"` : ""}
              </span>
            )}
            {c?.name_verified === "unverified" && (
              <span className="inline-flex items-center gap-1 text-pulse-warn">
                <AlertTriangle size={11} /> name unverified
              </span>
            )}
          </p>

          {stale && !blocked && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-pulse-warn">
              <Clock size={11} />
              Fault last checked{" "}
              {row.hook_verified_at
                ? new Date(
                    `${row.hook_verified_at}T00:00:00+10:00`,
                  ).toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "short",
                  })
                : "never"}
              . Re-verify before quoting it.
            </p>
          )}

          {row.hard_warning && (
            <p className="mt-2 flex items-start gap-1.5 rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-2.5 py-1.5 text-[11px] text-pulse-danger">
              {row.stage === "linkedin_only" ? (
                <Linkedin size={12} className="mt-0.5 shrink-0" />
              ) : (
                <ShieldAlert size={12} className="mt-0.5 shrink-0" />
              )}
              {row.hard_warning}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={cn(
              "data-mono text-[11px]",
              tone === "danger"
                ? "text-pulse-danger"
                : tone === "warn"
                  ? "text-pulse-warn"
                  : "text-pulse-text-mute",
            )}
          >
            {when}
          </span>

          {/* Only while it can still move. Once it has gone, when it was due is
              history rather than a setting. */}
          {row.scheduled_send_at && !row.sent_at && !blocked && (
            <Reschedule
              organisationId={row.id}
              current={row.scheduled_send_at}
            />
          )}

          {row.send_approved_at && !row.sent_at && (
            <span className="inline-flex items-center gap-1 text-[11px] text-pulse-success">
              <Check size={11} /> approved
            </span>
          )}

          {onSchedule && !blocked && !row.send_approved_at && (
            <button
              type="button"
              onClick={onSchedule}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[var(--radius-input)] border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50",
                row.scheduled_at
                  ? "border-pulse-gold/40 bg-pulse-gold/10 text-pulse-gold"
                  : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text",
              )}
            >
              {row.scheduled_at ? <Check size={12} /> : <CalendarClock size={12} />}
              {row.scheduled_at ? "Drafted" : "Mark drafted"}
            </button>
          )}

          {/* The three states of a send, in order. Draft it, send it in
              Outlook, then say so here. Only the last one writes a record,
              because only the last one is true. */}
          {!blocked && !row.sent_at && (
            <>
              {!row.draft_created_at && onDraft && (
                <button
                  type="button"
                  onClick={onDraft}
                  disabled={busy || !row.email_body}
                  title={
                    row.email_body
                      ? "Put a finished draft in your Outlook"
                      : "No email written for this record yet"
                  }
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] bg-pulse-gold px-2.5 py-1.5 text-xs font-medium text-pulse-bg transition-colors hover:bg-pulse-gold-light disabled:opacity-50"
                >
                  <FileEdit size={12} /> {busy ? "…" : "Draft in Outlook"}
                </button>
              )}
              {row.draft_created_at && (
                <>
                  {row.graph_web_link && (
                    <a
                      href={row.graph_web_link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] border border-pulse-border px-2.5 py-1.5 text-xs text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text"
                    >
                      <ExternalLink size={12} /> Open draft
                    </a>
                  )}
                  {onSent && (
                    <button
                      type="button"
                      onClick={onSent}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] bg-pulse-gold px-2.5 py-1.5 text-xs font-medium text-pulse-bg transition-colors hover:bg-pulse-gold-light disabled:opacity-50"
                    >
                      <Check size={12} /> {busy ? "…" : "I sent it"}
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {blocked && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-pulse-text-mute">
              <Ban size={12} /> no email
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
