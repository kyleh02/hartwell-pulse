"use client";

import { useMemo, useState } from "react";
import { Search, Download } from "lucide-react";
import type { BusinessSettings } from "@/lib/types/database";
import type { ReportBundle } from "@/lib/reports-shared";
import { sectionBlocks, metricKeyOf } from "@/lib/reports-shared";
import {
  ReportDocument,
  sectionAnchorId,
} from "@/components/reports/ReportDocument";
import {
  ReportLetterhead,
  ReportColophon,
} from "@/components/reports/ReportLetterhead";
import { IRONPEAK_DOC_CLASS, isIronpeak } from "@/lib/brand";
import { cn } from "@/lib/utils/cn";

export function ReportViewerChrome({
  bundle,
  imageUrls,
  business = null,
}: {
  bundle: ReportBundle;
  imageUrls: Record<string, string>;
  business?: BusinessSettings | null;
}) {
  const [query, setQuery] = useState("");
  const brand = bundle.report.brand ?? "hartwell";
  const ironpeak = isIronpeak(brand);

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

      <div className="min-w-0">
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

        {/* The sheet. An Ironpeak report is a white document with its own
            typography even on screen, the same way its invoices are, so what
            is previewed is what prints. A Hartwell report keeps the dark house
            look on screen and flips to light only in print. */}
        <div
          className={cn(
            "report-sheet",
            ironpeak &&
              `${IRONPEAK_DOC_CLASS} rounded-[var(--radius-card)] border border-pulse-border p-6 sm:p-10`,
          )}
        >
          <ReportLetterhead
            brand={brand}
            business={business}
            client={bundle.client}
            report={bundle.report}
          />

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

          <ReportColophon brand={brand} business={business} />
        </div>
      </div>
    </div>
  );
}
