"use client";

import { useMemo, useState } from "react";
import { Search, Download } from "lucide-react";
import type { ReportBundle } from "@/lib/reports-shared";
import { sectionBlocks, metricKeyOf } from "@/lib/reports-shared";
import {
  ReportDocument,
  sectionAnchorId,
} from "@/components/reports/ReportDocument";
import { Wordmark } from "@/components/brand/Wordmark";
import { monthLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils/cn";

export function ReportViewerChrome({
  bundle,
  imageUrls,
}: {
  bundle: ReportBundle;
  imageUrls: Record<string, string>;
}) {
  const [query, setQuery] = useState("");

  const haystacks = useMemo(
    () =>
      bundle.sections.map((s) => {
        const labels = sectionBlocks(s)
          .map((b) =>
            b.type === "metric"
              ? (bundle.metrics[metricKeyOf(b.serviceKey, b.metricKey)]?.label ??
                "")
              : b.caption,
          )
          .join(" ");
        return `${s.title} ${s.body ?? ""} ${labels}`.toLowerCase();
      }),
    [bundle],
  );

  const q = query.trim().toLowerCase();
  const allIndices = bundle.sections.map((_, i) => i);
  const matching = allIndices.filter((i) => !q || haystacks[i].includes(q));
  const hidden = allIndices.filter((i) => !matching.includes(i));

  return (
    <div className="lg:grid lg:grid-cols-[190px_1fr] lg:gap-10">
      <nav className="no-print mb-6 hidden self-start lg:sticky lg:top-24 lg:block">
        <p className="mono-label mb-3">Sections</p>
        <ul className="space-y-1.5">
          {bundle.sections.map((s, i) => (
            <li key={s.id} className={cn(!matching.includes(i) && "opacity-30")}>
              <a
                href={`#${sectionAnchorId(i)}`}
                className="text-sm text-pulse-text-dim transition-colors hover:text-pulse-gold"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div>
        <div className="print-only mb-8 border-b border-pulse-border pb-6">
          <Wordmark size="md" />
          <p className="mono-label mt-4">Performance report</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-pulse-text">
            {bundle.report.title}
          </h1>
          <p className="data-mono mt-1 text-sm text-pulse-text-dim">
            {bundle.client.business_name} ·{" "}
            {monthLabel(bundle.report.period_month)}
          </p>
        </div>

        <div className="no-print mb-6 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pulse-text-mute"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this report"
              className="w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 py-2 pl-9 pr-3 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-input)] bg-pulse-gold px-4 text-sm font-medium text-pulse-bg transition-colors hover:bg-pulse-gold-light"
          >
            <Download size={16} strokeWidth={2} />
            Download PDF
          </button>
        </div>

        {q && matching.length === 0 ? (
          <p className="text-sm text-pulse-text-dim">
            Nothing in this report matches that search.
          </p>
        ) : (
          <ReportDocument
            bundle={bundle}
            imageUrls={imageUrls}
            hiddenIndices={hidden}
          />
        )}
      </div>
    </div>
  );
}
