import type { MetricUnit } from "@/lib/types/database";

// =============================================================================
// Metric meaning + formatting
// The DB stores the raw numbers; this file knows what they MEAN — how to format
// each one and, crucially, whether a rise or a fall is good news. That lets the
// dashboard colour an improvement green even when the number went down (e.g. a
// falling cost per lead).
// =============================================================================

export type Better = "up" | "down" | "neutral";

export interface MetricMeta {
  /** Which direction is good for the client. */
  better: Better;
  /** Show this metric in the top summary cards row. */
  headline?: boolean;
  /** Sort order (lower first). */
  order: number;
}

// Known metrics. Anything not listed falls back to neutral so it still renders.
export const METRIC_META: Record<string, MetricMeta> = {
  leads: { better: "up", headline: true, order: 1 },
  conversion_rate: { better: "up", headline: true, order: 2 },
  cost_per_lead: { better: "down", headline: true, order: 3 },
  sessions: { better: "up", headline: true, order: 4 },
  roas: { better: "up", headline: true, order: 5 },
  open_rate: { better: "up", headline: true, order: 6 },
  ad_spend: { better: "neutral", order: 10 },
  clicks: { better: "up", order: 11 },
  impressions: { better: "neutral", order: 12 },
  ctr: { better: "up", order: 13 },
  reach: { better: "up", order: 14 },
  users: { better: "up", order: 15 },
  bounce_rate: { better: "down", order: 16 },
  avg_session_duration: { better: "up", order: 17 },
  click_rate: { better: "up", order: 18 },
  subscribers: { better: "up", order: 19 },
  unsubscribes: { better: "down", order: 20 },
};

export function metaFor(key: string): MetricMeta {
  return METRIC_META[key] ?? { better: "neutral", order: 99 };
}

/** Format a raw value for display, by unit. Australian English number style. */
export function formatMetricValue(value: number, unit: MetricUnit | null): string {
  switch (unit) {
    case "aud": {
      const decimals = Number.isInteger(value) && Math.abs(value) >= 100 ? 0 : 2;
      return (
        "$" +
        value.toLocaleString("en-AU", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      );
    }
    case "percent":
      return value.toLocaleString("en-AU", { maximumFractionDigits: 1 }) + "%";
    case "ratio":
      return value.toLocaleString("en-AU", { maximumFractionDigits: 1 }) + "x";
    case "seconds": {
      const m = Math.floor(value / 60);
      const s = Math.round(value % 60);
      return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }
    case "count":
    default:
      return value.toLocaleString("en-AU", { maximumFractionDigits: 0 });
  }
}

export interface Delta {
  /** Absolute percentage change, or null when there's no comparable prior value. */
  pct: number | null;
  direction: "up" | "down" | "flat";
  /** Whether the move is good, bad, or neutral for the client. Drives colour. */
  tone: "good" | "bad" | "neutral";
}

export function computeDelta(
  current: number,
  previous: number | undefined | null,
  better: Better,
): Delta {
  if (previous === undefined || previous === null) {
    return { pct: null, direction: "flat", tone: "neutral" };
  }
  const diff = current - previous;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const pct = previous === 0 ? null : (Math.abs(diff) / Math.abs(previous)) * 100;

  let tone: Delta["tone"] = "neutral";
  if (better !== "neutral" && direction !== "flat") {
    const isGood = better === "up" ? direction === "up" : direction === "down";
    tone = isGood ? "good" : "bad";
  }
  return { pct, direction, tone };
}

/** "8.4%" or "—" when there's no prior month to compare to. */
export function formatDeltaPct(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct.toFixed(1)}%`;
}

/** A "2026-06-01" style date to "June 2026" (or "Jun" when short). */
export function monthLabel(iso: string, short = false): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("en-AU", short ? { month: "short" } : { month: "long", year: "numeric" });
}
