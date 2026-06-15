import type { DashMetric } from "@/lib/dashboard";
import { formatMetricValue } from "@/lib/metrics";
import { DeltaBadge } from "@/components/dashboard/DeltaBadge";
import { Card } from "@/components/ui/Card";

export function StatCard({ metric }: { metric: DashMetric }) {
  return (
    <Card className="p-4">
      <p className="mono-label">{metric.label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="data-mono text-2xl font-medium text-pulse-text">
          {formatMetricValue(metric.current, metric.unit)}
        </span>
        <DeltaBadge delta={metric.delta} />
      </div>
      <p className="mt-1 text-[11px] text-pulse-text-mute">
        {metric.delta.pct !== null ? "vs last month" : "first month of data"}
      </p>
    </Card>
  );
}
