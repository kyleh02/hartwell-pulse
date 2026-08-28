"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createWork } from "@/app/admin/work/actions";
import { Button, buttonClasses } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

/**
 * Adding something by hand.
 *
 * Title is the only required field. A capture box that asks five questions is
 * one you route around, and the whole point of this list is that it is the
 * place things go rather than one of several.
 *
 * Steps are typed one per line, because a job with six parts is usually
 * written as six lines somewhere already.
 */
export function NewWorkForm({
  clients,
}: {
  clients: { id: string; business_name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [clientId, setClientId] = useState("");
  const [due, setDue] = useState("");
  const [time, setTime] = useState("");
  const [steps, setSteps] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTitle("");
    setDetail("");
    setClientId("");
    setDue("");
    setTime("");
    setSteps("");
    setError(null);
  }

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError("Give it a title.");
      return;
    }
    // A date with no time is a day, and has_time stays false so it sorts among
    // the day's work rather than pretending midnight was meant.
    const dueAt = due
      ? new Date(`${due}T${time || "09:00"}:00+10:00`).toISOString()
      : null;

    startTransition(async () => {
      const res = await createWork({
        title,
        detail,
        clientId: clientId || null,
        dueAt,
        hasTime: Boolean(due && time),
        steps: steps.split("\n"),
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClasses("primary", "sm")}
      >
        <Plus size={14} /> Add work
      </button>
    );
  }

  return (
    <div className="w-full rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="mono-label">New work</p>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit();
          }}
          placeholder="What needs doing"
          className={field}
        />

        <div className="grid gap-3.5 sm:grid-cols-3">
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
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={field}
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={!due}
            title="Only if the clock matters"
            className={field}
          />
        </div>

        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          placeholder="Any detail worth keeping with it"
          className={`${field} resize-y`}
        />

        <textarea
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          rows={3}
          placeholder="Steps, one per line. Leave empty for a single task."
          className={`${field} resize-y font-mono text-[13px]`}
        />

        {error && (
          <p className="rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? "Adding…" : "Add it"}
          </Button>
        </div>
      </div>
    </div>
  );
}
