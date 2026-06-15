"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMetricValue } from "@/lib/metrics";
import type { MetricUnit } from "@/lib/types/database";

interface Point {
  label: string;
  value: number;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  unit: MetricUnit | null;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-pulse-border bg-pulse-surface-2 px-3 py-2 shadow-lg">
      <p className="mono-label mb-0.5">{label}</p>
      <p className="data-mono text-sm text-pulse-text">
        {formatMetricValue(payload[0].value, unit)}
      </p>
    </div>
  );
}

export function MetricChart({
  data,
  unit,
}: {
  data: Point[];
  unit: MetricUnit | null;
}) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pulse-area-gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b5a675" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#b5a675" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            dy={6}
            tick={{
              fill: "var(--pulse-text-mute)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
          />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            content={<ChartTooltip unit={unit} />}
            cursor={{ stroke: "rgba(181,166,117,0.3)", strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#b5a675"
            strokeWidth={2}
            fill="url(#pulse-area-gold)"
            dot={false}
            activeDot={{ r: 3, fill: "#cbbe97", stroke: "none" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
