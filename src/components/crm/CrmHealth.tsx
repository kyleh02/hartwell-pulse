"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, Pencil } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { completeTask, saveCrmGoals } from "@/app/admin/crm/actions";
import type { CrmMetrics, CrmSettings } from "@/lib/types/database";
import type { DueTask } from "@/lib/crm";
import { cn } from "@/lib/utils/cn";

/**
 * The campaign's vital signs. Opt-outs sit first and stay first: it is the
 * health metric, not the reply rate. One forwarded complaint in a sector this
 * connected costs more than the campaign returns.
 */
export function CrmHealth({
  metrics,
  settings,
  dueTasks,
}: {
  metrics: CrmMetrics;
  settings: CrmSettings | null;
  dueTasks: DueTask[];
}) {
  const dailyGoal = settings?.daily_contact_goal ?? 3;
  const weeklyGoal = settings?.weekly_contact_goal ?? 3;
  const abortAt = settings?.abort_warning_sends ?? 15;
  const capacity = settings?.capacity_engagement_limit ?? 2;

  const [editing, setEditing] = useState(false);
  const [daily, setDaily] = useState(String(dailyGoal));
  const [weekly, setWeekly] = useState(String(weeklyGoal));
  const [pending, startTransition] = useTransition();

  const atCapacity = metrics.live_engagements >= capacity;
  const shouldAbort = metrics.sends_since_substantive >= abortAt;

  function saveGoals() {
    startTransition(async () => {
      await saveCrmGoals(Number(daily) || 0, Number(weekly) || 0);
      setEditing(false);
    });
  }

  return (
    <div className="space-y-4">
      {/* Blocking conditions come before the numbers. */}
      {atCapacity && (
        <Banner tone="warn">
          {metrics.live_engagements} engagements are live, which is your capacity
          limit. Outbound sending is paused until one is delivered. Three yeses in
          a fortnight breaks a one person business.
        </Banner>
      )}
      {shouldAbort && (
        <Banner tone="danger">
          {metrics.sends_since_substantive} sends since the last substantive reply.
          The playbook says stop and reconsider the offer rather than finishing the
          list on momentum. The observation in the emails is probably not specific
          enough to survive being read aloud to an engineering manager.
        </Banner>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Opt-outs and complaints"
          value={metrics.opt_outs}
          target="target zero"
          tone={metrics.opt_outs > 0 ? "danger" : "success"}
          lead
        />
        <Stat
          label="Sent this week"
          value={metrics.sent}
          target={`goal ${weeklyGoal}`}
          tone="steel"
        />
        <Stat
          label="Replies"
          value={metrics.replies}
          target="3 to 5 per 15"
          tone="default"
        />
        <Stat
          label="Substantive replies"
          value={metrics.substantive}
          target="2 to 3 per 15"
          tone={metrics.substantive > 0 ? "success" : "default"}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        {/* Today's goal */}
        <Card className="p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="mono-label">// Today</p>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-label="Edit goals"
              className="text-pulse-text-mute transition-colors hover:text-pulse-text"
            >
              <Pencil size={12} />
            </button>
          </div>

          {editing ? (
            <div className="mt-3 space-y-2">
              <GoalField label="Per day" value={daily} onChange={setDaily} />
              <GoalField label="Per week" value={weekly} onChange={setWeekly} />
              <button
                type="button"
                onClick={saveGoals}
                disabled={pending}
                className="w-full rounded-[var(--radius-input)] bg-pulse-steel px-3 py-1.5 text-xs font-medium text-pulse-bg transition-colors hover:bg-pulse-steel-bright disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save goals"}
              </button>
              <p className="text-[11px] text-pulse-text-mute">
                The playbook benchmark is three a week, not a day. Volume is the
                risk in a sector this connected.
              </p>
            </div>
          ) : (
            <>
              <p className="data-mono mt-1 text-2xl text-pulse-text">
                {metrics.sent_today}
                <span className="text-base text-pulse-text-mute"> / {dailyGoal}</span>
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-pulse-surface-2">
                <div
                  className="h-full rounded-full bg-pulse-steel transition-all"
                  style={{
                    width: `${dailyGoal > 0 ? Math.min(100, (metrics.sent_today / dailyGoal) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-pulse-text-dim">
                {metrics.sent_today >= dailyGoal
                  ? "Today's goal is met. Stop here."
                  : `${dailyGoal - metrics.sent_today} to go. Only counts when a send is logged.`}
              </p>
            </>
          )}
        </Card>

        {/* Due now */}
        <Card className="p-4">
          <p className="mono-label">// Due now</p>
          {dueTasks.length === 0 ? (
            <p className="mt-2 text-sm text-pulse-text-dim">
              Nothing due. Follow-ups appear here on day 8 to 10 after a first
              email.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {dueTasks.slice(0, 6).map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: DueTask }) {
  const [pending, startTransition] = useTransition();
  const overdue = task.due_on < new Date().toISOString().slice(0, 10);
  return (
    <li className="flex items-start gap-2 text-sm">
      <button
        type="button"
        onClick={() => startTransition(async () => void (await completeTask(task.id)))}
        disabled={pending}
        aria-label="Mark done"
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-pulse-border text-transparent transition-colors hover:border-pulse-steel hover:text-pulse-steel disabled:opacity-50"
      >
        <Check size={11} />
      </button>
      <span className="min-w-0">
        <span className="block text-pulse-text">{task.title}</span>
        <span className="data-mono block text-[11px] text-pulse-text-mute">
          {task.organisation_name ?? "No company"} ·{" "}
          <span className={overdue ? "text-pulse-danger" : undefined}>
            {overdue ? "overdue" : "due"} {task.due_on}
          </span>
        </span>
      </span>
    </li>
  );
}

function GoalField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs text-pulse-text-dim">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2 py-1 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none"
      />
    </label>
  );
}

function Stat({
  label,
  value,
  target,
  tone,
  lead,
}: {
  label: string;
  value: number;
  target: string;
  tone: "default" | "steel" | "success" | "danger";
  lead?: boolean;
}) {
  const colour = {
    default: "text-pulse-text",
    steel: "text-pulse-steel",
    success: "text-pulse-success",
    danger: "text-pulse-danger",
  }[tone];
  return (
    <Card className={cn("p-4", lead && "border-pulse-border-strong")}>
      <p className="mono-label">{label}</p>
      <p className={cn("data-mono mt-1 text-xl sm:text-2xl", colour)}>{value}</p>
      <p className="data-mono mt-0.5 text-[10px] text-pulse-text-mute">{target}</p>
    </Card>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "warn" | "danger";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--radius-card)] border px-4 py-3 text-sm",
        tone === "danger"
          ? "border-pulse-danger/40 bg-pulse-danger/10 text-pulse-text"
          : "border-pulse-warn/40 bg-pulse-warn/10 text-pulse-text",
      )}
    >
      <AlertTriangle
        size={15}
        className={cn(
          "mt-0.5 shrink-0",
          tone === "danger" ? "text-pulse-danger" : "text-pulse-warn",
        )}
      />
      <span>{children}</span>
    </div>
  );
}
