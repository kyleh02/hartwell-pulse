"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { DeltaBadge } from "@/components/dashboard/DeltaBadge";
import { MetricChart } from "@/components/dashboard/MetricChart";
import { formatMetricValue } from "@/lib/metrics";
import type { DashSection } from "@/lib/dashboard";

export function ServiceSection({
  section,
  defaultOpen = true,
}: {
  section: DashSection;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const primary = section.primary;

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-pulse-surface-2/40"
      >
        <SectionLabel parts={["Performance", section.displayName]} />
        <span className="flex items-center gap-3">
          {primary && <DeltaBadge delta={primary.delta} />}
          <ChevronDown
            size={16}
            className={cn(
              "text-pulse-text-mute transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-pulse-border p-5">
          {primary && (
            <div className="mb-5">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm text-pulse-text-dim">
                  {primary.label}
                </span>
                <span className="data-mono text-lg text-pulse-text">
                  {formatMetricValue(primary.current, primary.unit)}
                </span>
              </div>
              <MetricChart data={primary.series} unit={primary.unit} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {section.metrics.map((m) => (
              <div
                key={m.key}
                className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 p-3"
              >
                <p className="mono-label">{m.label}</p>
                <div className="mt-1.5 flex items-end justify-between gap-2">
                  <span className="data-mono text-base text-pulse-text">
                    {formatMetricValue(m.current, m.unit)}
                  </span>
                  <DeltaBadge delta={m.delta} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
