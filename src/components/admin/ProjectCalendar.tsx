"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { BoardCard } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function ProjectCalendar({
  cards,
  today,
  onEditCard,
  onAddOnDay,
}: {
  cards: BoardCard[];
  today: string; // YYYY-MM-DD, computed on the server to avoid hydration drift
  onEditCard: (card: BoardCard) => void;
  onAddOnDay: (dateStr: string) => void;
}) {
  const [view, setView] = useState({
    y: Number(today.slice(0, 4)),
    m: Number(today.slice(5, 7)) - 1,
  });

  const first = new Date(view.y, view.m, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = new Map<string, BoardCard[]>();
  for (const c of cards) {
    if (!c.due_date) continue;
    const arr = byDate.get(c.due_date) ?? [];
    arr.push(c);
    byDate.set(c.due_date, arr);
  }

  const monthLabel = first.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });

  function shift(delta: number) {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
      <div className="flex items-center justify-between border-b border-pulse-border px-4 py-3">
        <span className="text-sm font-medium text-pulse-text">{monthLabel}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() =>
              setView({
                y: Number(today.slice(0, 4)),
                m: Number(today.slice(5, 7)) - 1,
              })
            }
            className="rounded px-2 py-1 text-xs text-pulse-text-dim hover:text-pulse-text"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded text-pulse-text-mute hover:bg-pulse-surface-2 hover:text-pulse-text"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-pulse-border">
        {WEEKDAYS.map((w) => (
          <div key={w} className="mono-label px-2 py-1.5 text-center">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const dateStr = d ? iso(view.y, view.m, d) : null;
          const dayCards = dateStr ? (byDate.get(dateStr) ?? []) : [];
          const isToday = dateStr === today;
          return (
            <div
              key={i}
              className={cn(
                "group min-h-[96px] border-b border-r border-pulse-border p-1.5",
                !d && "bg-pulse-bg/30",
              )}
            >
              {d && dateStr && (
                <>
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "data-mono text-[11px]",
                        isToday
                          ? "flex h-5 w-5 items-center justify-center rounded-full bg-pulse-gold font-medium text-pulse-bg"
                          : "text-pulse-text-mute",
                      )}
                    >
                      {d}
                    </span>
                    <button
                      type="button"
                      onClick={() => onAddOnDay(dateStr)}
                      aria-label="Add card on this day"
                      className="text-pulse-text-mute opacity-0 transition-opacity hover:text-pulse-text group-hover:opacity-100"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayCards.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onEditCard(c)}
                        className="block w-full truncate rounded bg-pulse-surface-2 px-1.5 py-0.5 text-left text-[11px] text-pulse-text-dim hover:text-pulse-text"
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
