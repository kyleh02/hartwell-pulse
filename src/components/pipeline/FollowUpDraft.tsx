"use client";

import { useState } from "react";
import { Copy, Mail, Sparkles } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

/**
 * Claude drafts the follow-up; Kyle edits it and sends it from his own email.
 * The portal never sends it: "Open in email" hands the words to his mail app.
 */
export function FollowUpDraft({ leadId, email }: { leadId: string; email: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/draft-follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const j = (await res.json().catch(() => ({}))) as { subject?: string; body?: string; error?: string };
      if (!res.ok || !j.body) setError(j.error ?? "Couldn't draft that one.");
      else {
        setSubject(j.subject ?? "");
        setBody(j.body);
      }
    } catch {
      setError("Couldn't reach the portal. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const mailto = email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;

  return (
    <section className="space-y-3 rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="card-title">Follow-up email</h2>
        <Button size="sm" variant="secondary" onClick={make} disabled={busy}>
          <Sparkles size={13} aria-hidden="true" /> {busy ? "Drafting…" : body ? "Draft again" : "Draft one"}
        </Button>
      </div>
      {!body && !error && (
        <p className="text-sm text-pulse-text-dim">Claude writes a short follow-up from what&apos;s logged here. You edit it and send it yourself.</p>
      )}
      {error && <p className="text-sm text-pulse-danger">{error}</p>}
      {body && (
        <>
          <input className={field} aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className={`${field} min-h-48 leading-relaxed`} aria-label="Email" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {mailto && (
              <a href={mailto} className={buttonClasses("primary", "sm")}>
                <Mail size={13} aria-hidden="true" /> Open in email
              </a>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                navigator.clipboard?.writeText(`Subject: ${subject}\n\n${body}`).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                })
              }
            >
              <Copy size={13} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-pulse-text-mute">Once it&apos;s sent, log it under What happened.</p>
        </>
      )}
    </section>
  );
}
