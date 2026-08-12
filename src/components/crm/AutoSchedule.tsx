"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { autoSchedule } from "@/app/admin/crm/actions";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Lay the queue out across the coming weekdays in one press.
 *
 * The schedule used to be written by hand in the handoff document and re-typed
 * into the database, which meant every slipped day was a round trip through
 * another conversation and a block of SQL. The rules are fixed and few, so a
 * machine can apply them and a person can look at the result.
 */
export function AutoSchedule() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function run() {
    if (
      !window.confirm(
        "Lay out the schedule from tomorrow?\n\nFour a day, weekdays only, odd minutes, WA after 11am AEST, follow-ups inside their window. Anything already drafted keeps its time.",
      )
    )
      return;
    setNote(null);
    startTransition(async () => {
      try {
        const r = await autoSchedule();
        setNote(
          r.scheduled === 0
            ? "Nothing left to schedule."
            : `${r.scheduled} scheduled, starting ${new Date(r.firstDay!).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`,
        );
        router.refresh();
      } catch (e) {
        setNote(e instanceof Error ? e.message : "Could not schedule.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={buttonClasses("secondary", "sm")}
      >
        <CalendarRange size={14} />
        {pending ? "Scheduling…" : "Auto-schedule the queue"}
      </button>
      {note && (
        <p className="max-w-sm text-right text-[11px] text-pulse-text-mute">
          {note}
        </p>
      )}
    </div>
  );
}
