"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Mail, ShieldAlert, X } from "lucide-react";
import {
  saveOutreachEmail,
  approveForSending,
  unapproveSending,
} from "@/app/admin/crm/actions";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

/**
 * The nine checks, ticked at approval rather than at send.
 *
 * Copied deliberately from the manual log-a-send flow so both paths ask the
 * same nine questions. If they ever diverge, the automated path becomes the
 * easy way to skip a check, which is the opposite of the point.
 */
const PRESEND: readonly (readonly [string, string])[] = [
  ["c1", "The name is a real one from the page you screenshotted, not a bracket"],
  ["c2", "Every dollar figure, stream and project description copied verbatim"],
  ["c3", "Every 'not findable' line actually searched today"],
  ["c4", "At least one finding specific to their technical domain, not their marketing"],
  ["c5", "At least one positive finding, with the reason it is good"],
  ["c6", "Opt-out line present, worded exactly as in the template"],
  ["c7", "Address is the one published verbatim on their page, not constructed"],
  ["c8", "Screenshot of their contact page saved and dated"],
  ["c9", "One sentence here could not have been sent to any other company"],
];

export function OutreachComposer({
  organisationId,
  initialSubject,
  initialBody,
  scheduledSendAt,
  approvedAt,
  sendError,
  hardWarning,
  recipient,
}: {
  organisationId: string;
  initialSubject: string | null;
  initialBody: string | null;
  scheduledSendAt: string | null;
  approvedAt: string | null;
  sendError: string | null;
  hardWarning: string | null;
  recipient: string | null;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const approved = Boolean(approvedAt);
  const ticked = PRESEND.filter(([k]) => checks[k]).length;

  const when = scheduledSendAt
    ? new Date(scheduledSendAt).toLocaleString("en-AU", {
        timeZone: "Australia/Brisbane",
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveOutreachEmail(organisationId, subject, body);
        setSaved(true);
        setNote(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  function approve() {
    if (
      !window.confirm(
        `Approve this to send automatically?\n\nTo: ${recipient ?? "the published address"}\nWhen: ${when ?? "no time set"}\n\nIt goes on its own, from your Outlook, whether or not you are at the desk. Nothing else will ask you first.`,
      )
    )
      return;
    setError(null);
    setNote(null);
    startTransition(async () => {
      await saveOutreachEmail(organisationId, subject, body);
      const res = await approveForSending(organisationId, checks);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSaved(true);
      setNote("Approved. It will go at its scheduled time.");
      router.refresh();
    });
  }

  function unapprove() {
    startTransition(async () => {
      await unapproveSending(organisationId);
      setNote(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="mono-label">The email</p>
        {approved ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pulse-success/40 bg-pulse-success/10 px-2.5 py-1 text-[11px] text-pulse-success">
            <Check size={11} /> approved, sending {when}
          </span>
        ) : (
          <span className="data-mono text-[11px] text-pulse-text-mute">
            {saved ? "saved" : "unsaved"}
          </span>
        )}
      </div>

      {hardWarning && (
        <p className="mb-3 flex items-start gap-1.5 rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          {hardWarning}
        </p>
      )}

      {sendError && (
        <p className="mb-3 rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
          Last attempt failed: {sendError}
        </p>
      )}

      <label className="mb-2 flex flex-col gap-1">
        <span className="mono-label">Subject</span>
        <input
          value={subject}
          disabled={approved}
          onChange={(e) => {
            setSubject(e.target.value);
            setSaved(false);
          }}
          className="w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text focus:border-pulse-border-strong focus:outline-none disabled:opacity-60"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="mono-label">Body</span>
        <textarea
          value={body}
          disabled={approved}
          onChange={(e) => {
            setBody(e.target.value);
            setSaved(false);
          }}
          rows={14}
          placeholder="Plain text, the way you would type it in Outlook. No signature or opt-out line: those are added on the way out so they cannot be wrong on one of them."
          className="w-full resize-y rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3 text-sm leading-relaxed text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none disabled:opacity-60"
        />
      </label>

      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-pulse-text-mute">
        <Mail size={12} className="mt-0.5 shrink-0" />
        Sent as plain text from your Outlook, so it arrives as an ordinary
        email. Your name, Ironpeak, the ABN and a working opt-out link are
        appended automatically.
      </p>

      {!approved && (
        <div className="mt-4 border-t border-pulse-border pt-3">
          <p className="mono-label mb-2">
            Pre-send checks · {ticked} of 9
          </p>
          {/* Ticked now, not at send time. Nobody is here at 8:47am, and a
              checklist confirmed by a machine is not a check. */}
          <ul className="space-y-1.5">
            {PRESEND.map(([key, text]) => (
              <li key={key}>
                <label className="flex cursor-pointer items-start gap-2 text-xs text-pulse-text-dim">
                  <input
                    type="checkbox"
                    checked={Boolean(checks[key])}
                    onChange={(e) =>
                      setChecks((c) => ({ ...c, [key]: e.target.checked }))
                    }
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-pulse-gold"
                  />
                  {text}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
          {error}
        </p>
      )}
      {note && !error && (
        <p className="mt-3 rounded-[var(--radius-input)] border border-pulse-success/40 bg-pulse-success/10 px-3 py-2 text-xs text-pulse-success">
          {note}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {approved ? (
          <Button variant="ghost" size="sm" onClick={unapprove} disabled={pending}>
            <X size={14} /> Take it back out
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={save} disabled={pending}>
              Save
            </Button>
            <Button
              size="sm"
              onClick={approve}
              disabled={pending || ticked < 9 || !subject.trim() || !body.trim()}
              title={
                ticked < 9
                  ? "All nine checks first"
                  : `Send automatically ${when ?? ""}`
              }
            >
              <Clock size={14} /> Approve to send
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
