"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { saveSettings, type SettingsInput } from "@/app/admin/outreach/sender-actions";
import type { DraperSettings } from "@/lib/outreach/types";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] text-pulse-text-mute">{label}</span>
      <div className="mt-0.5">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-pulse-text-mute">{hint}</span>}
    </label>
  );
}

/** Draper's settings. Saving makes a new version; nothing is overwritten. */
export function SettingsForm({ s }: { s: DraperSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState<SettingsInput>({
    master_on: s.master_on,
    test_mode: s.test_mode,
    test_inboxes: s.test_inboxes.join(", "),
    daily_first_emails: s.daily_first_emails,
    window_start: s.window_start.slice(0, 5),
    window_end: s.window_end.slice(0, 5),
    gap_min_minutes: s.gap_min_minutes,
    gap_max_minutes: s.gap_max_minutes,
    stop_window_minutes: s.stop_window_minutes,
    pause_from: s.pause_from ?? "",
    pause_to: s.pause_to ?? "",
    opt_out_line: s.opt_out_line,
    send_weekends: s.send_weekends === true,
  });
  const [note, setNote] = useState("");
  const set = <K extends keyof SettingsInput>(k: K, v: SettingsInput[K]) => setF({ ...f, [k]: v });

  function save(e: React.FormEvent) {
    e.preventDefault();
    const goingLive = f.master_on && !f.test_mode && !(s.master_on && !s.test_mode);
    if (
      goingLive &&
      !window.confirm(
        "Master switch on and test mode off: Draper will email real businesses. Anything still waiting from test mode (the sample workshop included) is dropped first. Go live?",
      )
    )
      return;
    setMsg(null);
    start(async () => {
      const r = await saveSettings(f, note.trim());
      setMsg(r.ok ? { ok: true, text: "Saved as a new version." } : { ok: false, text: r.message });
      if (r.ok) setNote("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2 rounded-[var(--radius-input)] border border-pulse-border p-3">
          <input type="checkbox" className="mt-1" checked={f.master_on} onChange={(e) => set("master_on", e.target.checked)} />
          <span>
            <span className="block text-sm text-pulse-text">Master switch</span>
            <span className="block text-[12px] text-pulse-text-mute">Off: no business is ever emailed. On with test mode off: Draper is live.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded-[var(--radius-input)] border border-pulse-border p-3">
          <input type="checkbox" className="mt-1" checked={f.test_mode} onChange={(e) => set("test_mode", e.target.checked)} />
          <span>
            <span className="block text-sm text-pulse-text">Test mode</span>
            <span className="block text-[12px] text-pulse-text-mute">Every email goes to your test inboxes instead, even with the master switch off.</span>
          </span>
        </label>
      </div>
      <label className="flex items-start gap-2 rounded-[var(--radius-input)] border border-pulse-border p-3">
        <input type="checkbox" className="mt-1" checked={f.send_weekends} onChange={(e) => set("send_weekends", e.target.checked)} />
        <span>
          <span className="block text-sm text-pulse-text">Send on weekends</span>
          <span className="block text-[12px] text-pulse-text-mute">Saturdays and Sundays become sending days. Public holidays and your pause dates are still skipped.</span>
        </span>
      </label>
      <Field label="Test inboxes" hint="One Gmail and one Outlook, separated by commas.">
        <input className={field} value={f.test_inboxes} onChange={(e) => set("test_inboxes", e.target.value)} placeholder="you@gmail.com, you@outlook.com" />
      </Field>
      <Field label={`First emails a sending day: ${f.daily_first_emails}`} hint="Warms up at 5 a day for five sending days, then 10, 15 and 20. Past 12 a day go in Check these.">
        <input type="range" min={1} max={25} className="w-full" value={f.daily_first_emails} onChange={(e) => set("daily_first_emails", Number(e.target.value))} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Window opens">
          <input type="time" className={field} value={f.window_start} onChange={(e) => set("window_start", e.target.value)} />
        </Field>
        <Field label="Window closes">
          <input type="time" className={field} value={f.window_end} onChange={(e) => set("window_end", e.target.value)} />
        </Field>
        <Field label="Shortest gap (min)">
          <input type="number" min={10} max={120} className={field} value={f.gap_min_minutes} onChange={(e) => set("gap_min_minutes", Number(e.target.value))} />
        </Field>
        <Field label="Longest gap (min)">
          <input type="number" min={10} max={180} className={field} value={f.gap_max_minutes} onChange={(e) => set("gap_max_minutes", Number(e.target.value))} />
        </Field>
        <Field label="Stop window (min)" hint="After the 8am summary.">
          <input type="number" min={0} max={300} className={field} value={f.stop_window_minutes} onChange={(e) => set("stop_window_minutes", Number(e.target.value))} />
        </Field>
        <Field label="Pause from">
          <input type="date" className={field} value={f.pause_from} onChange={(e) => set("pause_from", e.target.value)} />
        </Field>
        <Field label="Pause to">
          <input type="date" className={field} value={f.pause_to} onChange={(e) => set("pause_to", e.target.value)} />
        </Field>
        <Field label="Follow-up opt-out line">
          <select className={field} value={f.opt_out_line} onChange={(e) => set("opt_out_line", e.target.value === "B" ? "B" : "A")}>
            <option value="A">A: just reply and say so</option>
            <option value="B">B: one word back helps</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="What changed and why (goes in the change log)">
            <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Added test inboxes" />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </div>
      <p className="text-[11px] text-pulse-text-mute">
        Version {s.version}. Anything that won&apos;t fit in the window goes the next sending day. For 25 first emails and their
        follow-ups, open the window about 8:30am to 5:30pm with 10 to 15 minutes between sends.
      </p>
      {msg && <p className={msg.ok ? "text-[13px] text-pulse-success" : "text-[13px] text-pulse-danger"}>{msg.text}</p>}
    </form>
  );
}
