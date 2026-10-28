"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, MessageSquareWarning } from "lucide-react";
import type { ApprovalStatus } from "@/lib/approvals-shared";
import { decideApproval, clientComment } from "@/app/(client)/approvals/actions";
import { adminComment } from "@/app/admin/approvals/actions";
import { Button } from "@/components/ui/Button";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2.5 text-base text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none sm:text-sm";

/**
 * Approve, or ask for changes. Two clear choices and nothing else, because the
 * whole point of the board is that saying yes takes one tap. Asking for
 * changes needs a sentence, so Kyle is never left guessing what to change.
 */
export function ApprovalDecision({ id, status }: { id: string; status: ApprovalStatus }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "approve" | "changes">(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (status !== "waiting") {
    return (
      <div className="rounded-[16px] border border-pulse-border bg-pulse-surface p-5">
        <p className="card-title">{status === "approved" ? "Approved" : "With Kyle"}</p>
        <p className="mt-2 text-sm text-pulse-text-dim">
          {status === "approved"
            ? "Thanks, this is signed off. Kyle will take it from here."
            : "Kyle is making the changes you asked for. You'll get an email when the next version is ready."}
        </p>
      </div>
    );
  }

  function submit(decision: "approved" | "changes") {
    setError(null);
    start(async () => {
      const res = await decideApproval(id, decision, text);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMode(null);
      setText("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-[16px] border border-pulse-warn/40 bg-pulse-surface p-5">
      <p className="card-title">Your call</p>
      <p className="mt-2 text-sm text-pulse-text-dim">Happy with it? Approve it. Not quite? Tell Kyle what to change.</p>

      {mode === null ? (
        <div className="mt-4 grid gap-2">
          <Button onClick={() => setMode("approve")} className="h-12 w-full">
            <CircleCheck size={17} aria-hidden="true" /> Approve
          </Button>
          <Button variant="secondary" onClick={() => setMode("changes")} className="h-12 w-full">
            <MessageSquareWarning size={17} aria-hidden="true" /> Ask for changes
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={mode === "approve" ? "Anything to add? (optional)" : "What would you like changed?"}
            className={field}
          />
          {error && <p className="text-xs text-pulse-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => submit(mode === "approve" ? "approved" : "changes")}
              disabled={pending || (mode === "changes" && !text.trim())}
            >
              {pending ? "Sending…" : mode === "approve" ? "Approve it" : "Send to Kyle"}
            </Button>
            <Button variant="ghost" onClick={() => { setMode(null); setError(null); }} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      )}
      {error && mode === null && <p className="mt-3 text-xs text-pulse-danger">{error}</p>}
    </div>
  );
}

/** A note on a piece of work, from either side. */
export function ApprovalComment({ id, role }: { id: string; role: "client" | "admin" }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    start(async () => {
      const res = role === "client" ? await clientComment(id, text) : await adminComment(id, text);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setText("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={role === "client" ? "A question or a note for Kyle" : "A note for the client"}
        className={field}
      />
      {error && <p className="text-xs text-pulse-danger">{error}</p>}
      <Button variant="secondary" size="sm" onClick={send} disabled={pending || !text.trim()}>
        {pending ? "Sending…" : "Add comment"}
      </Button>
    </div>
  );
}
