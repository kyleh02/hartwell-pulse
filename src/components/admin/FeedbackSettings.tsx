"use client";

import { useState, useTransition } from "react";
import { saveFeedbackSettings } from "@/app/admin/settings/feedback-actions";
import { Button } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

/** Client feedback: whether clients are asked, and where a happy one is sent. */
export function FeedbackSettings({ enabled, reviewUrl }: { enabled: boolean; reviewUrl: string | null }) {
  const [on, setOn] = useState(enabled);
  const [url, setUrl] = useState(reviewUrl ?? "");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setNote(null);
    start(async () => {
      const res = await saveFeedbackSettings({ enabled: on, reviewUrl: url });
      setNote(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.message });
    });
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-pulse-text">Client feedback</h2>
        <Button size="sm" variant="secondary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="grid gap-4 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--pulse-gold)]" />
          <span className="text-sm leading-relaxed text-pulse-text-dim">
            <span className="font-semibold text-pulse-text">Ask clients how you&apos;re going.</span> One question, 0 to 10, on their Home and
            by email, 30 days after they start and then every quarter. A low score emails you straight away. Weekday mornings only.
          </span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-pulse-text-dim">Your Google review link, shown to anyone who answers 9 or 10</span>
          <input className={field} type="url" placeholder="https://g.page/r/..." value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        {note && <p className={note.ok ? "text-xs text-pulse-success" : "text-xs text-pulse-danger"}>{note.text}</p>}
      </div>
    </section>
  );
}
