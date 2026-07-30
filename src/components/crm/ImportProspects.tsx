"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { importGrantRecipients } from "@/app/admin/crm/actions";

/**
 * One-press import of the grant recipient list. Safe to press more than once:
 * the action skips anything already there, so a partial import just finishes.
 */
export function ImportProspects() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await importGrantRecipients();
        setResult(
          r.organisations === 0 && r.grants === 0
            ? "Already up to date, nothing to add."
            : `Imported ${r.organisations} companies and ${r.grants} grants.`,
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed.");
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={run} disabled={pending}>
        <Download size={15} /> {pending ? "Importing…" : "Import grant recipients"}
      </Button>
      {result && <p className="text-xs text-pulse-success">{result}</p>}
      {error && (
        <p className="max-w-md rounded-[var(--radius-input)] border border-pulse-danger/40 bg-pulse-danger/10 px-3 py-2 text-xs text-pulse-danger">
          {error}
        </p>
      )}
    </div>
  );
}
