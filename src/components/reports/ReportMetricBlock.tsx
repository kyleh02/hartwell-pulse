import type { ReportMetric } from "@/lib/reports-shared";
import { formatMetricValue } from "@/lib/metrics";
import { DeltaBadge } from "@/components/dashboard/DeltaBadge";
import { MetricChart } from "@/components/dashboard/MetricChart";

export function ReportMetricBlock({
  metric,
  chart,
}: {
  metric: ReportMetric | undefined;
  chart: boolean;
}) {
  if (!metric) {
    return (
      <div className="rounded-[var(--radius-input)] border border-dashed border-pulse-border p-4 text-xs text-pulse-text-mute">
        This metric is no longer available.
      </div>
    );
  }
  return (
    <div className="report-block rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="data-mono text-2xl text-pulse-text">
          {formatMetricValue(metric.current, metric.unit)}
        </p>
        <DeltaBadge delta={metric.delta} />
      </div>
      <p className="mono-label mt-1">{metric.label}</p>
      {chart && metric.series.length > 1 && (
        <div className="mt-3">
          <MetricChart data={metric.series} unit={metric.unit} />
        </div>
      )}
    </div>
  );
}
