"use client";

import { Download } from "lucide-react";

export function PrintButton({ label = "Download PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex h-9 items-center gap-2 rounded-[var(--radius-input)] bg-pulse-gold px-3 text-sm font-medium text-pulse-bg transition-colors hover:bg-pulse-gold-light"
    >
      <Download size={15} strokeWidth={2} /> {label}
    </button>
  );
}
