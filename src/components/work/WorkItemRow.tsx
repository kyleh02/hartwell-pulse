"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  GripVertical,
  Plus,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import {
  completeWork,
  snoozeWork,
  dropWork,
  toggleStep,
  addStep,
  deleteStep,
  logHours,
  deleteWork,
  updateWork,
  reopenWork,
} from "@/app/admin/work/actions";
import {
  daysOverdue,
  needsConfirmation,
  sourceHref,
  stepProgress,
  SOURCE_LABEL,
  TZ,
  type WorkRow,
} from "@/lib/work-shared";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";

function timeLabel(iso: string) {
  return new Date(iso)
    .toLocaleTimeString("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    .toLowerCase();
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Tomorrow, next week, and a date, as the snooze menu offers them. */
function snoozeOptions(): { label: string; at: string }[] {
  const mk = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };
  return [
    { label: "Tomorrow", at: mk(1) },
    { label: "In 3 days", at: mk(3) },
    { label: "Next week", at: mk(7) },
  ];
}

/**
 * One line of work, with the three buttons that make this a system rather than
 * a list: done, snooze, not doing.
 *
 * Done is refused on a cold email and an invoice, and says where to go
 * instead. That refusal is the point rather than an inconvenience: the touch
 * log is the Spam Act defence and "paid" says money arrived, and neither
 * should be decided by a checkbox among twelve others.
 */
export function WorkItemRow({
  row,
  dragHandle,
}: {
  row: WorkRow;
  dragHandle?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [dropReason, setDropReason] = useState("");
  const [newStep, setNewStep] = useState("");
  const [hoursText, setHoursText] = useState(row.hours?.toString() ?? "");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(row.title);
  const [editDue, setEditDue] = useState(
    row.due_at ? new Date(row.due_at).toISOString().slice(0, 10) : "",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const overdue = daysOverdue(row);
  const progress = stepProgress(row.steps);
  const href = sourceHref(row);
  const confirmElsewhere = needsConfirmation(row);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setMessage(res.message ?? "That did not work.");
      else router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border bg-pulse-surface transition-colors",
        overdue > 0 ? "border-pulse-warn/40" : "border-pulse-border",
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        {dragHandle ?? <span className="w-0" />}

        {/* Done. On the two consequential kinds this refuses and explains. */}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => completeWork(row.id))}
          title={
            confirmElsewhere
              ? "Confirm this where it happens"
              : "Mark it done"
          }
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
            confirmElsewhere
              ? "border-pulse-border text-pulse-text-mute hover:border-pulse-warn hover:text-pulse-warn"
              : "border-pulse-border text-transparent hover:border-pulse-success hover:text-pulse-success",
          )}
        >
          <Check size={13} strokeWidth={2.5} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <p className="text-[0.9375rem] leading-snug text-pulse-text">{row.title}</p>
            {row.client_name && (
              <span className="mono-label">{row.client_name}</span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-pulse-text-mute">
            <span className="mono-label">{SOURCE_LABEL[row.source_kind]}</span>
            {row.due_at && row.has_time && (
              <span className="data-mono text-pulse-text-dim">
                {timeLabel(row.due_at)}
              </span>
            )}
            {row.due_at && !row.has_time && (
              <span className="data-mono">{dayLabel(row.due_at)}</span>
            )}
            {overdue > 0 && (
              <span className="text-pulse-warn">
                {overdue} day{overdue === 1 ? "" : "s"} overdue
              </span>
            )}
            {progress.total > 0 && (
              <span>
                {progress.done} of {progress.total}
              </span>
            )}
            {row.hours !== null && (
              <span className="data-mono">{row.hours}h</span>
            )}
            {href && (
              <Link
                href={href}
                className="inline-flex items-center gap-1 text-pulse-gold hover:underline"
              >
                Open <ExternalLink size={11} />
              </Link>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {row.state !== "open" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => run(() => reopenWork(row.id))}
            >
              Put it back
            </Button>
          )}
          <button
            type="button"
            disabled={pending || row.state !== "open"}
            onClick={() => setSnoozeOpen((v) => !v)}
            title="Snooze"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
          >
            <Clock size={15} />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setDropOpen((v) => !v)}
            title="Not doing this"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-danger"
          >
            <X size={15} />
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title="Details"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
          >
            <ChevronDown
              size={15}
              className={cn("transition-transform", open && "rotate-180")}
            />
          </button>
        </div>
      </div>

      {snoozeOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t border-pulse-border px-4 py-3">
          <span className="mono-label">Snooze until</span>
          {snoozeOptions().map((o) => (
            <Button
              key={o.label}
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                setSnoozeOpen(false);
                run(() => snoozeWork(row.id, o.at));
              }}
            >
              {o.label}
            </Button>
          ))}
          <input
            type="date"
            disabled={pending}
            onChange={(e) => {
              if (!e.target.value) return;
              const at = new Date(`${e.target.value}T09:00:00+10:00`).toISOString();
              setSnoozeOpen(false);
              run(() => snoozeWork(row.id, at));
            }}
            className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2.5 py-1.5 text-xs text-pulse-text focus:outline-none"
          />
        </div>
      )}

      {dropOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t border-pulse-border px-4 py-3">
          <span className="mono-label">Why not</span>
          <input
            value={dropReason}
            onChange={(e) => setDropReason(e.target.value)}
            placeholder="Optional, one line"
            className="min-w-0 flex-1 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-xs text-pulse-text placeholder:text-pulse-text-mute focus:outline-none"
          />
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => {
              setDropOpen(false);
              run(() => dropWork(row.id, dropReason));
            }}
          >
            Not doing it
          </Button>
        </div>
      )}

      {open && (
        <div className="space-y-5 border-t border-pulse-border px-4 py-4">
          {row.detail && (
            <p className="text-sm leading-relaxed text-pulse-text-dim">{row.detail}</p>
          )}

          <div>
            <div className="mb-2.5 flex items-center gap-2.5">
              <p className="mono-label">Title and date</p>
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="text-[11px] text-pulse-text-mute hover:text-pulse-text"
              >
                {editing ? "cancel" : "change"}
              </button>
            </div>
            {editing && (
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="min-w-0 flex-1 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-sm text-pulse-text focus:outline-none"
                />
                <input
                  type="date"
                  value={editDue}
                  onChange={(e) => setEditDue(e.target.value)}
                  className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2.5 py-1.5 text-xs text-pulse-text focus:outline-none"
                />
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setEditing(false);
                    run(() =>
                      updateWork(row.id, {
                        title: editTitle,
                        // Keeping the clock only if it had one: a date picker
                        // has no time in it, and silently moving an 08:47 send
                        // to midnight would be worse than refusing the edit.
                        dueAt: editDue
                          ? new Date(
                              `${editDue}T${
                                row.has_time && row.due_at
                                  ? new Date(row.due_at)
                                      .toTimeString()
                                      .slice(0, 5)
                                  : "09:00"
                              }:00+10:00`,
                            ).toISOString()
                          : null,
                      }),
                    );
                  }}
                >
                  Save
                </Button>
              </div>
            )}
            <p className="mono-label mb-2.5">Steps</p>
            <ul className="space-y-1.5">
              {row.steps.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => toggleStep(s.id, !s.done_at))}
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                      s.done_at
                        ? "border-pulse-success bg-pulse-success/15 text-pulse-success"
                        : "border-pulse-border text-transparent hover:border-pulse-success",
                    )}
                  >
                    <Check size={11} strokeWidth={2.5} />
                  </button>
                  <span
                    className={cn(
                      "flex-1 text-sm",
                      s.done_at
                        ? "text-pulse-text-mute line-through"
                        : "text-pulse-text-dim",
                    )}
                  >
                    {s.label}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteStep(s.id))}
                    className="text-pulse-text-mute hover:text-pulse-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex items-center gap-2">
              <input
                value={newStep}
                onChange={(e) => setNewStep(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newStep.trim()) {
                    const label = newStep;
                    setNewStep("");
                    run(() => addStep(row.id, label));
                  }
                }}
                placeholder="Add a step, then Enter"
                className="min-w-0 flex-1 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-1.5 text-xs text-pulse-text placeholder:text-pulse-text-mute focus:outline-none"
              />
              <button
                type="button"
                disabled={pending || !newStep.trim()}
                onClick={() => {
                  const label = newStep;
                  setNewStep("");
                  run(() => addStep(row.id, label));
                }}
                className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mono-label flex items-center gap-1.5">
              <Timer size={12} /> Hours
            </span>
            <input
              value={hoursText}
              onChange={(e) => setHoursText(e.target.value)}
              onBlur={() => {
                const v = hoursText.trim() === "" ? null : Number(hoursText);
                if (v !== row.hours) run(() => logHours(row.id, v));
              }}
              inputMode="decimal"
              placeholder="0.0"
              className="data-mono w-20 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2.5 py-1.5 text-xs text-pulse-text focus:outline-none"
            />
            <span className="text-xs text-pulse-text-mute">
              Logged after the fact. No timer to forget to stop.
            </span>
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Delete "${row.title}" for good?`)) {
                  run(() => deleteWork(row.id));
                }
              }}
            >
              <Trash2 size={13} /> Delete
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p className="border-t border-pulse-warn/40 bg-pulse-warn/10 px-4 py-2.5 text-xs text-pulse-warn">
          {message}
          {href && (
            <>
              {" "}
              <Link href={href} className="underline">
                Open it
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export { GripVertical };
