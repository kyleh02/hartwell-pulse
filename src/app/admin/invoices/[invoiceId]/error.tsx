"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/Button";

/**
 * What to show when the invoice editor fails to render.
 *
 * There was no boundary here, so a render error produced a blank screen: no
 * message, no clue, nothing to act on or report. On the page where money is
 * raised that is the worst possible failure, because the reasonable response
 * to a blank screen is to try again and then give up.
 *
 * Deliberately shows the error text rather than a friendly apology. This page
 * is admin only, Kyle is the only person who will ever see it, and the message
 * is the difference between "it broke" and knowing why.
 */
export default function InvoiceEditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[invoice editor]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl py-10">
      <div className="rounded-[var(--radius-card)] border border-pulse-danger/40 bg-pulse-danger/10 p-6">
        <p className="mono-label flex items-center gap-2 text-pulse-danger">
          <AlertTriangle size={14} /> This invoice would not open
        </p>

        <p className="mt-4 text-sm leading-relaxed text-pulse-text-dim">
          The invoice itself is fine and nothing has been changed. This is the
          editor failing to draw, and the reason is below.
        </p>

        <pre className="mt-4 overflow-x-auto rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3 text-xs leading-relaxed text-pulse-text-dim">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
          <Link href="/admin/invoices" className={buttonClasses("ghost", "sm")}>
            All invoices
          </Link>
        </div>

        <p className="mt-5 text-xs text-pulse-text-mute">
          If you need the invoice out now, open it from All invoices and use
          Send there, or send the PDF from your own email. Nothing about this
          stops the invoice being valid.
        </p>
      </div>
    </div>
  );
}
