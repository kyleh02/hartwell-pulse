import type { ReportBundle, ReportBlock } from "@/lib/reports-shared";
import { sectionBlocks, sectionPageBreak, metricKeyOf } from "@/lib/reports-shared";
import { ReportMetricBlock } from "@/components/reports/ReportMetricBlock";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import { ReportText } from "@/components/reports/ReportText";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { cn } from "@/lib/utils/cn";

type MetricBlock = Extract<ReportBlock, { type: "metric" }>;
type ImageBlock = Extract<ReportBlock, { type: "image" }>;

export function sectionAnchorId(index: number) {
  return `report-section-${index}`;
}

export function ReportDocument({
  bundle,
  imageUrls,
  hiddenIndices = [],
}: {
  bundle: ReportBundle;
  imageUrls: Record<string, string>;
  hiddenIndices?: number[];
}) {
  const hidden = new Set(hiddenIndices);
  const summary = bundle.report.summary?.trim();
  return (
    <article className="space-y-12">
      {/* The opening block: everything above the first heading in the draft.
          The importer has always stored this, and nothing ever rendered it, so
          a report's at-a-glance table went straight into the database and was
          never seen by anyone. */}
      {summary && (
        <section className="report-section report-lead">
          <ReportText body={summary} />
        </section>
      )}

      {bundle.sections.map((section, i) => {
        const blocks = sectionBlocks(section);
        const metricBlocks = blocks.filter(
          (b): b is MetricBlock => b.type === "metric",
        );
        const imageBlocks = blocks.filter(
          (b): b is ImageBlock => b.type === "image",
        );

        return (
          <section
            key={section.id}
            id={sectionAnchorId(i)}
            className={cn(
              hidden.has(i) && "hidden",
              !hidden.has(i) && "report-section scroll-mt-24",
              // Only meaningful in print. A section marked as a new chapter
              // starts at the top of a fresh page rather than halfway down one.
              !hidden.has(i) && sectionPageBreak(section) && "report-page-break",
            )}
          >
            {/* The heading and its rule are one unit, so a page never breaks
                between a section title and the first line under it. */}
            <div className="report-section-head mb-5 border-b border-pulse-border pb-3">
              <SectionLabel parts={[section.kind, section.title]} />
              <h2 className="report-heading mt-2 text-xl font-semibold tracking-tight text-pulse-text">
                {section.title}
              </h2>
            </div>

            <ReportText body={section.body} />

            {metricBlocks.length > 0 && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {metricBlocks.map((b) => (
                  <div key={b.id} className="report-block">
                    <ReportMetricBlock
                      metric={bundle.metrics[metricKeyOf(b.serviceKey, b.metricKey)]}
                      chart={b.chart}
                    />
                  </div>
                ))}
              </div>
            )}

            {imageBlocks.map((b) => (
              <figure key={b.id} className="report-figure mt-5">
                {imageUrls[b.path] && (
                  <ZoomableImage
                    src={imageUrls[b.path]}
                    alt={b.caption || "Report image"}
                    className="w-full rounded-[var(--radius-card)] border border-pulse-border"
                  />
                )}
                {b.caption && (
                  <figcaption className="mt-1.5 text-xs text-pulse-text-mute">
                    {b.caption}
                  </figcaption>
                )}
              </figure>
            ))}
          </section>
        );
      })}
    </article>
  );
}
