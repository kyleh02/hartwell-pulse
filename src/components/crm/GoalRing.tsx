"use client";

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import type { ActivityDay } from "@/lib/crm";
import { cn } from "@/lib/utils/cn";

/**
 * Today's progress as a ring, with the fortnight behind it.
 *
 * The ring fills rather than a bar because the goal is a target to reach, not a
 * quantity to accumulate: it should read as complete or not at a glance from
 * across the desk. The bars underneath give it context, since one number in
 * isolation cannot tell you whether today is a good day or a quiet week.
 */
export function GoalRing({
  done,
  goal,
  streak,
  days,
}: {
  done: number;
  goal: number;
  streak: number;
  days: ActivityDay[];
}) {
  const target = Math.max(goal, 1);
  const pct = Math.min(1, done / target);
  const met = done >= goal && goal > 0;

  // Animate up on mount so the ring draws itself rather than snapping.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(pct);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 650);
      // ease-out cubic
      setShown(pct * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pct]);

  const r = 34;
  const circumference = 2 * Math.PI * r;
  const busiest = Math.max(1, ...days.map((d) => d.sent));

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
          <circle
            cx="44"
            cy="44"
            r={r}
            fill="none"
            strokeWidth="7"
            className="stroke-pulse-surface-2"
          />
          <circle
            cx="44"
            cy="44"
            r={r}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            className={met ? "stroke-pulse-success" : "stroke-pulse-steel"}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - shown)}
            transform="rotate(-90 44 44)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              "data-mono text-xl leading-none",
              met ? "text-pulse-success" : "text-pulse-text",
            )}
          >
            {done}
          </span>
          <span className="data-mono text-[10px] text-pulse-text-mute">
            of {goal}
          </span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="mono-label">// Today</p>
        <p className="mt-1 text-sm text-pulse-text-dim">
          {goal === 0
            ? "No daily goal set."
            : met
              ? "Goal met. Stop here rather than pushing on."
              : `${goal - done} to go.`}
        </p>

        {streak > 1 && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-pulse-gold">
            <Flame size={13} />
            {streak} day streak
          </p>
        )}

        {/* The fortnight, so today has something to sit against. */}
        <div className="mt-3 flex items-end gap-[3px]" aria-hidden="true">
          {days.map((d) => {
            const hit = goal > 0 && d.sent >= goal;
            const height = Math.max(3, Math.round((d.sent / busiest) * 22));
            return (
              <span
                key={d.day}
                title={`${d.day}: ${d.sent}`}
                style={{ height }}
                className={cn(
                  "w-full max-w-[10px] flex-1 rounded-[2px]",
                  d.sent === 0
                    ? "bg-pulse-surface-2"
                    : hit
                      ? "bg-pulse-success/70"
                      : "bg-pulse-steel/60",
                )}
              />
            );
          })}
        </div>
        <p className="data-mono mt-1 text-[10px] text-pulse-text-mute">
          Last {days.length} days
        </p>
      </div>
    </div>
  );
}
