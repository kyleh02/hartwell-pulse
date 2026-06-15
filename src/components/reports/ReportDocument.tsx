import type { ReportBundle, ReportBlock } from "@/lib/reports-shared";
import { sectionBlocks, metricKeyOf } from "@/lib/reports-shared";
import { ReportMetricBlock } from "@/components/reports/ReportMetricBlock";
import { ReportText } from "@/components/reports/ReportText";
import { SectionLabel } from "@/components/ui/SectionLabel";

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
  return (
    <article className="space-y-10">
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
            className={hidden.has(i) ? "hidden" : "report-section scroll-mt-24"}
          >
            <SectionLabel parts={[section.kind, section.title]} className="mb-3" />
            <h2 className="report-heading mb-4 text-xl font-semibold tracking-tight text-pulse-text">
              {section.title}
            </h2>

            <ReportText body={section.body} />

            {metricBlocks.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {metricBlocks.map((b) => (
                  <ReportMetricBlock
                    key={b.id}
                    metric={bundle.metrics[metricKeyOf(b.serviceKey, b.metricKey)]}
                    chart={b.chart}
                  />
                ))}
              </div>
            )}

            {imageBlocks.map((b) => (
              <figure key={b.id} className="report-figure mt-4">
                {imageUrls[b.path] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
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
