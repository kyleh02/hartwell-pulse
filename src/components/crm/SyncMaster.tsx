"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncPipelineMaster } from "@/app/admin/crm/actions";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Applies the researched pipeline master over the prospects already here.
 *
 * It updates rather than replaces, so anything the spreadsheet does not carry,
 * the research notes and the logged sends with their dates, survives. Safe to
 * press again whenever the master changes.
 */
export function SyncMaster() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    setResult(null);
    setNote(null);
    startTransition(async () => {
      try {
        const r = await syncPipelineMaster();
        setResult(
          `${r.updated} companies updated, ${r.contacts} contacts written, ${r.skipped} ruled out.`,
        );
        if (r.needSourceUrl > 0) {
          setNote(
            `${r.needSourceUrl} contacts still need the URL their address was published at. Sends stay blocked until each one has it, because that link is the evidence.`,
          );
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sync failed.");
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
        <RefreshCw size={14} className={pending ? "animate-spin" : undefined} />
        {pending ? "Syncing…" : "Sync master list"}
      </button>
      {result && (
        <p className="max-w-sm text-right text-xs text-pulse-success">{result}</p>
      )}
      {note && (
        <p className="max-w-sm text-right text-xs text-pulse-warn">{note}</p>
      )}
      {error && (
        <p className="max-w-sm rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-right text-xs text-pulse-danger">
          {error}
        </p>
      )}
    </div>
  );
}
