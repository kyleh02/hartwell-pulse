"use client";

import { useMemo } from "react";
import { WorkItemRow } from "@/components/work/WorkItemRow";
import {
  bucketFor,
  compareWork,
  isSnoozed,
  TZ,
  type WorkRow,
} from "@/lib/work-shared";
import { cn } from "@/lib/utils/cn";

/**
 * The board and the calendar, over the same rows the list uses.
 *
 * Views rather than stores, which is the whole difference from what was here
 * before. Ticking something on Today moves it on the board, because there is
 * only one of it.
 */

/**
 * Three columns, derived rather than stored.
 *
 * The old board had a column_key Kyle dragged between, which meant a card's
 * state and its due date could disagree and neither was wrong. Here the column
 * IS the date: nothing to keep in step, and no way to have a card sitting in
 * "in progress" that was due last month.
 */
export function WorkBoard({ rows }: { rows: WorkRow[] }) {
  const cols = useMemo(() => {
    const live = rows.filter((r) => !isSnoozed(r));
    return [
      {
        key: "now",
        label: "Now",
        hint: "Overdue and today",
        items: live
          .filter((r) => ["overdue", "today"].includes(bucketFor(r)))
          .sort(compareWork),
      },
      {
        key: "next",
        label: "Next",
        hint: "Dated, further out",
        items: live.filter((r) => bucketFor(r) === "later").sort(compareWork),
      },
      {
        key: "someday",
        label: "Someday",
        hint: "No date yet",
        items: live.filter((r) => bucketFor(r) === "someday").sort(compareWork),
      },
    ];
  }, [rows]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {cols.map((c) => (
        <section key={c.key}>
          <div className="mb-4">
            <div className="flex items-center gap-2.5">
              <span className="mono-label">{c.label}</span>
              <span className="data-mono text-xs text-pulse-text-mute">
                {c.items.length}
              </span>
              <span className="h-px flex-1 bg-pulse-border" />
            </div>
            <p className="mt-1.5 text-xs text-pulse-text-mute">{c.hint}</p>
          </div>
          <div className="space-y-2.5">
            {c.items.length === 0 ? (
              <p className="text-sm text-pulse-text-mute">Nothing here.</p>
            ) : (
              c.items.map((r) => <WorkItemRow key={r.id} row={r} />)
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function startOfWeek(d: Date): Date {
  const s = new Date(d);
  // Monday, because a working week starts on one.
  const day = (s.getDay() + 6) % 7;
  s.setDate(s.getDate() - day);
  s.setHours(0, 0, 0, 0);
  return s;
}

/**
 * Two weeks, day by day.
 *
 * A fortnight rather than a month: the month view of a solo operator's work is
 * mostly empty squares, and the question a calendar answers here is "is
 * Thursday already full", which needs the next ten working days and no more.
 */
export function WorkCalendar({ rows }: { rows: WorkRow[] }) {
  const days = useMemo(() => {
    const start = startOfWeek(new Date());
    const live = rows.filter((r) => !isSnoozed(r) && r.due_at);
    return Array.from({ length: 14 }, (_, i) => {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      const key = day.toDateString();
      return {
        day,
        items: live
          .filter((r) => new Date(r.due_at!).toDateString() === key)
          .sort(compareWork),
      };
    });
  }, [rows]);

  const todayKey = new Date().toDateString();

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {days.map(({ day, items }) => {
        const isToday = day.toDateString() === todayKey;
        const weekend = [0, 6].includes(day.getDay());
        return (
          <div
            key={day.toISOString()}
            className={cn(
              "rounded-[var(--radius-card)] border p-3.5",
              isToday
                ? "border-pulse-gold/50 bg-pulse-surface"
                : weekend
                  ? "border-pulse-border bg-pulse-surface/40"
                  : "border-pulse-border bg-pulse-surface",
            )}
          >
            <p
              className={cn(
                "mono-label",
                isToday ? "text-pulse-gold" : undefined,
              )}
            >
              {day.toLocaleDateString("en-AU", {
                timeZone: TZ,
                weekday: "short",
                day: "numeric",
              })}
            </p>
            <ul className="mt-3 space-y-2">
              {items.length === 0 ? (
                <li className="text-xs text-pulse-text-mute">&mdash;</li>
              ) : (
                items.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/60 px-2.5 py-2"
                  >
                    <p className="text-xs leading-snug text-pulse-text">
                      {r.title}
                    </p>
                    {r.client_name && (
                      <p className="mt-1 text-[11px] text-pulse-text-mute">
                        {r.client_name}
                      </p>
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
