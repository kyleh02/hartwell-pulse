"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

/**
 * The client's Download PDF: the portal's own PDF of the invoice, the same file
 * the email carried, rather than the browser's print of the screen.
 *
 * Usually instant. When the file has to be made first (a correction saved since
 * the last one, or an invoice from before 2 November 2026) it takes a cold
 * Chromium start, so the button says it is preparing rather than looking dead.
 * If anything fails it prints the page instead, which paginates the same way,
 * so the client always gets a PDF of some kind.
 */
export function InvoicePdfButton({ invoiceId }: { invoiceId: string }) {
  const [preparing, setPreparing] = useState(false);

  async function download() {
    setPreparing(true);
    let url: string | null = null;
    try {
      const res = await fetch(`/invoices/${invoiceId}/pdf`, { method: "POST" });
      const body = res.ok ? ((await res.json()) as { ok: boolean; url?: string }) : null;
      if (body?.ok && body.url) url = body.url;
    } catch {
      // Falls through to printing the page.
    }
    setPreparing(false);
    // The signed URL answers as a download, so the page stays where it is.
    if (url) window.location.assign(url);
    else window.print();
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={preparing}
      aria-busy={preparing}
      className="no-print inline-flex h-9 items-center gap-2 rounded-[var(--radius-input)] bg-pulse-gold px-3 text-sm font-medium text-pulse-bg transition-colors hover:bg-pulse-gold-light disabled:opacity-80"
    >
      {preparing ? (
        <Loader2 size={15} strokeWidth={2} className="animate-spin" />
      ) : (
        <Download size={15} strokeWidth={2} />
      )}
      {preparing ? "Preparing PDF" : "Download PDF"}
    </button>
  );
}
