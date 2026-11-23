"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { addCalendarEvent } from "@/app/admin/calendar/actions";
import { Button } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

/** Add an event to admin@'s Google Calendar from the portal. */
export function AddCalendarEvent({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [allDay, setAllDay] = useState(false);
  const [startT, setStartT] = useState("09:00");
  const [endT, setEndT] = useState("09:30");
  const [notes, setNotes] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setNote(null);
    start(async () => {
      const r = await addCalendarEvent({ title, date, allDay, start: startT, end: endT, notes });
      if (r.ok) {
        setNote({ ok: true, text: "Added to your Google Calendar." });
        setTitle("");
        setNotes("");
      } else setNote({ ok: false, text: r.message });
    });
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" /> Add event
      </Button>
    );
  }

  return (
    <div className="mb-6 grid gap-3 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
      <label className="grid gap-1.5">
        <span className="text-sm text-pulse-text-dim">Title</span>
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call with Deepayan" autoFocus />
      </label>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="grid gap-1.5">
          <span className="text-sm text-pulse-text-dim">Date</span>
          <input className={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {!allDay && (
          <>
            <label className="grid gap-1.5">
              <span className="text-sm text-pulse-text-dim">Start</span>
              <input className={field} type="time" value={startT} onChange={(e) => setStartT(e.target.value)} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm text-pulse-text-dim">End</span>
              <input className={field} type="time" value={endT} onChange={(e) => setEndT(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-pulse-text-dim">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 accent-[var(--pulse-gold)]" />
        All day
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm text-pulse-text-dim">Notes (optional)</span>
        <textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={pending || !title.trim()}>
          {pending ? "Adding…" : "Add to calendar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Close
        </Button>
        {note && <span className={note.ok ? "text-xs text-pulse-success" : "text-xs text-pulse-danger"}>{note.text}</span>}
      </div>
    </div>
  );
}
