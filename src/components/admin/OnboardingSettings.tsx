"use client";

import { useState, useTransition } from "react";
import { DEFAULT_WELCOME } from "@/lib/onboarding-shared";
import { saveOnboardingSettings } from "@/app/admin/settings/onboarding-actions";
import { Button } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

/** The booking link new clients use, and the note they are welcomed with. */
export function OnboardingSettings({
  kickoffUrl,
  welcome,
}: {
  kickoffUrl: string | null;
  welcome: string | null;
}) {
  const [url, setUrl] = useState(kickoffUrl ?? "");
  const [text, setText] = useState(welcome ?? "");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setNote(null);
    start(async () => {
      const res = await saveOnboardingSettings({ kickoffUrl: url, welcome: text });
      setNote(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.message });
    });
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-pulse-text">New client onboarding</h2>
        <Button size="sm" variant="secondary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="grid gap-3 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
        <label className="flex flex-col gap-1">
          <span className="mono-label">Kickoff call booking link</span>
          <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendly.com/… or your Google booking page" />
          <span className="text-xs text-pulse-text-mute">
            New clients see a Choose a time button with this link. Leave it empty and they're told you'll be in touch.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">Your welcome note</span>
          <textarea className={field} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={DEFAULT_WELCOME} />
          <span className="text-xs text-pulse-text-mute">Shown beside your photo when they first sign in. Empty uses the note shown faintly above.</span>
        </label>
        {note && <p className={note.ok ? "text-xs text-pulse-success" : "text-xs text-pulse-danger"}>{note.text}</p>}
      </div>
    </section>
  );
}
