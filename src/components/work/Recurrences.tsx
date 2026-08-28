"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Plus, Trash2, X } from "lucide-react";
import {
  createRecurrence,
  toggleRecurrence,
  deleteRecurrence,
} from "@/app/admin/work/actions";
import { Button, buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils/cn";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface RecurrenceListRow {
  id: string;
  title: string;
  detail: string | null;
  client_name: string | null;
  pattern: "weekly" | "monthly" | "quarterly" | "annual";
  day_of_week: number | null;
  day_of_month: number | null;
  lead_days: number;
  steps: { label: string }[];
  active: boolean;
  last_made_on: string | null;
}

function whenLabel(r: RecurrenceListRow): string {
  if (r.pattern === "weekly") return `Every ${DAYS[r.day_of_week ?? 1]}`;
  const day = r.day_of_month ?? 1;
  const noun =
    r.pattern === "monthly"
      ? "month"
      : r.pattern === "quarterly"
        ? "quarter"
        : "year";
  return `Day ${day} of the ${noun}`;
}

/**
 * The work that comes back, and where a retained client is declared.
 *
 * Nothing infers which clients get a monthly report. Kyle sets one up per
 * client once and it becomes a fact, which is better than a rule that would be
 * wrong about exactly the accounts mid-change and wrong quietly.
 */
export function Recurrences({
  rows,
  clients,
}: {
  rows: RecurrenceListRow[];
  clients: { id: string; business_name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [pattern, setPattern] =
    useState<RecurrenceListRow["pattern"]>("monthly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [leadDays, setLeadDays] = useState(0);
  const [steps, setSteps] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.message ?? "That did not work.");
      else router.refresh();
    });
  }

  function submit() {
    if (!title.trim()) {
      setError("Give it a title.");
      return;
    }
    run(async () => {
      const res = await createRecurrence({
        title,
        clientId: clientId || null,
        pattern,
        dayOfWeek,
        dayOfMonth,
        leadDays,
        steps: steps.split("\n"),
      });
      if (res.ok) {
        setTitle("");
        setSteps("");
        setOpen(false);
      }
      return res;
    });
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between gap-4">
        <p className="max-w-2xl text-sm text-pulse-text-dim">
          Anything on a rhythm. Each one drops a fresh item on the list when its
          lead time arrives, with its checklist already on it.
        </p>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={buttonClasses("primary", "sm")}
          >
            <Plus size={14} /> Add one
          </button>
        )}
      </div>

      {open && (
        <div className="mb-8 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="mono-label">New recurrence</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-pulse-text-mute hover:text-pulse-text"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3.5">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Monthly report, Haús of Vitality"
              className={field}
            />

            <div className="grid gap-3.5 sm:grid-cols-4">
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className={field}
              >
                <option value="">No client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.business_name}
                  </option>
                ))}
              </select>

              <select
                value={pattern}
                onChange={(e) =>
                  setPattern(e.target.value as RecurrenceListRow["pattern"])
                }
                className={field}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>

              {pattern === "weekly" ? (
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className={field}
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  className={field}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Day {d}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={leadDays}
                onChange={(e) => setLeadDays(Number(e.target.value))}
                title="How far ahead it appears on the list"
                className={field}
              >
                {[0, 1, 2, 3, 5, 7, 14].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "On the day" : `${d} days early`}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={4}
              placeholder={"Steps, one per line.\nWrite it\nPublish\nMake the PDF\nTest to me\nSend"}
              className={`${field} resize-y font-mono text-[13px]`}
            />

            {error && (
              <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={pending}>
                {pending ? "Adding…" : "Add it"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing repeats yet"
          description="Set up the monthly reports and the weekly checks here, and they will appear on the list on their own."
        />
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div
              key={r.id}
              className={cn(
                "rounded-[var(--radius-card)] border bg-pulse-surface px-4 py-3.5",
                r.active ? "border-pulse-border" : "border-pulse-border opacity-60",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <p className="text-[0.9375rem] text-pulse-text">{r.title}</p>
                    {r.client_name && (
                      <span className="mono-label">{r.client_name}</span>
                    )}
                    {!r.active && (
                      <span className="mono-label text-pulse-text-mute">paused</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-pulse-text-mute">
                    {whenLabel(r)}
                    {r.lead_days > 0 && `, ${r.lead_days} days early`}
                    {r.steps.length > 0 && ` · ${r.steps.length} steps`}
                    {r.last_made_on && ` · last made ${r.last_made_on}`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => toggleRecurrence(r.id, !r.active))}
                    title={r.active ? "Pause it" : "Start it again"}
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
                  >
                    {r.active ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Delete "${r.title}" and its checklist?`)) {
                        run(() => deleteRecurrence(r.id));
                      }
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
