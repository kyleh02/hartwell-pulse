"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { setScheduledSendAt } from "@/app/admin/crm/actions";
import { cn } from "@/lib/utils/cn";

/**
 * Move one send to a different time.
 *
 * The times came out of the handoff and the handoff assumed the week started
 * on time. Once a morning has passed, a slot at 08:47 means "as soon as
 * approved", which is not the same thing and not always what is wanted.
 *
 * Approval survives a reschedule. The nine checks are about the content, and
 * none of them stops being true because the email goes at three instead of
 * nine.
 */
export function Reschedule({
  organisationId,
  current,
}: {
  organisationId: string;
  current: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(current));
  const [pending, startTransition] = useTransition();

  function save() {
    if (!value) return;
    // datetime-local has no zone; the browser is on Kyle's clock, so parsing it
    // as local time and storing the resulting instant is correct.
    const iso = new Date(value).toISOString();
    startTransition(async () => {
      await setScheduledSendAt(organisationId, iso);
      setOpen(false);
      router.refresh();
    });
  }

  /** A minute that is not on the hour or the half hour, per Kyle's rule. */
  function shiftTo(hour: number, minute: number) {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    startTransition(async () => {
      await setScheduledSendAt(organisationId, d.toISOString());
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] text-pulse-text-mute underline decoration-dotted underline-offset-2 hover:text-pulse-text"
      >
        <CalendarClock size={11} /> reschedule
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-2 py-1 text-xs text-pulse-text focus:border-pulse-border-strong focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-end gap-1">
        {/* This afternoon, at minutes nobody would pick by accident. */}
        {[
          [13, 38],
          [14, 21],
          [15, 47],
          [16, 12],
        ].map(([h, m]) => (
          <button
            key={`${h}:${m}`}
            type="button"
            disabled={pending}
            onClick={() => shiftTo(h, m)}
            className="rounded border border-pulse-border px-1.5 py-0.5 text-[11px] text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text disabled:opacity-50"
          >
            {h}:{String(m).padStart(2, "0")}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-1.5 py-0.5 text-[11px] text-pulse-text-mute hover:text-pulse-text"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending || !value}
          className={cn(
            "rounded bg-pulse-gold px-2 py-0.5 text-[11px] font-medium text-pulse-bg disabled:opacity-50",
          )}
        >
          {pending ? "…" : "set"}
        </button>
      </div>
    </div>
  );
}

/** An ISO instant as the "YYYY-MM-DDTHH:MM" a datetime-local input wants. */
function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
