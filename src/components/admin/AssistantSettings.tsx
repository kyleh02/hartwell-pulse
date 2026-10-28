"use client";

import { useState, useTransition } from "react";
import { saveAssistantSettings } from "@/app/admin/settings/assistant-actions";
import { Button } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

const PLACEHOLDER = `What you do and who for. How you work: how often you report, how approvals work, how quickly you reply, your hours. Answers to questions clients often ask.

Leave prices out. The assistant never quotes them and passes those questions to you.`;

/** The portal assistant: on or off, and what it may say about Hartwell Digital. */
export function AssistantSettings({ enabled, knowledge, keySet }: { enabled: boolean; knowledge: string | null; keySet: boolean }) {
  const [on, setOn] = useState(enabled);
  const [text, setText] = useState(knowledge ?? "");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setNote(null);
    start(async () => {
      const res = await saveAssistantSettings({ enabled: on, knowledge: text });
      setNote(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.message });
    });
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-pulse-text">Portal assistant</h2>
        <Button size="sm" variant="secondary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="grid gap-4 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
        {!keySet && (
          <p className="rounded-[var(--radius-input)] border border-pulse-gold/40 bg-pulse-gold/[0.06] px-3 py-2 text-sm text-pulse-text-dim">
            Needs an Anthropic API key before it can answer. Add <code className="data-mono text-pulse-text">ANTHROPIC_API_KEY</code> in
            Vercel, Settings, Environment Variables, then redeploy.
          </p>
        )}
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--pulse-gold)]" />
          <span className="text-sm leading-relaxed text-pulse-text-dim">
            <span className="font-semibold text-pulse-text">Answer client questions straight away.</span> Adds a Quick answers tab to the
            chat bubble, run by Claude. It knows how the portal works, the client&apos;s own account and your notes below, nothing else. Prices,
            changes and complaints come to you. You get one email per conversation.
          </span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-pulse-text-dim">What it may tell clients about Hartwell Digital</span>
          <textarea className={`${field} min-h-48 leading-relaxed`} placeholder={PLACEHOLDER} value={text} onChange={(e) => setText(e.target.value)} maxLength={12000} />
        </label>
        {note && <p className={note.ok ? "text-xs text-pulse-success" : "text-xs text-pulse-danger"}>{note.text}</p>}
      </div>
    </section>
  );
}
