"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Replace } from "lucide-react";
import { replacePipeline } from "@/app/admin/crm/actions";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Load the 7 August 2026 handoff over the top of whatever is here.
 *
 * Destructive, and the confirm says so in plain terms rather than asking "are
 * you sure". Anything not in the new list is deleted, EXCEPT companies that
 * have already been emailed: a logged send is the Spam Act record and outranks
 * a tidy list, so those are marked lost and kept.
 */
export function ReplacePipeline() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (
      !window.confirm(
        `Replace the Ironpeak pipeline with the 7 August handoff?

The 30 companies in the handoff are written in, with their ranks, send times, hooks and notes. Anything not on that list is deleted, except companies you have already emailed, which are kept and marked lost so the send record survives.

This cannot be undone from here.`,
      )
    )
      return;
    setError(null);
    setResult(null);
    setNote(null);
    startTransition(async () => {
      try {
        const r = await replacePipeline();
        setResult(
          `${r.created} added, ${r.updated} updated, ${r.removed} removed.`,
        );
        if (r.keptWithHistory > 0) {
          setNote(
            `${r.keptWithHistory} kept because they have a logged send. A compliance record outranks a tidy list.`,
          );
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not replace it.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={buttonClasses("secondary", "sm")}
      >
        <Replace size={14} />
        {pending ? "Replacing…" : "Load 7 Aug pipeline"}
      </button>
      {result && (
        <p className="max-w-sm text-right text-xs text-pulse-success">{result}</p>
      )}
      {note && <p className="max-w-sm text-right text-xs text-pulse-warn">{note}</p>}
      {error && (
        <p className="max-w-sm rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-right text-xs text-pulse-danger">
          {error}
        </p>
      )}
    </div>
  );
}
