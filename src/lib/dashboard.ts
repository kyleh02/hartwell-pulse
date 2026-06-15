import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metric, Service, MetricUnit, ServiceKey } from "@/lib/types/database";
import { computeDelta, metaFor, monthLabel, type Delta } from "@/lib/metrics";

export interface DashMetric {
  key: string;
  label: string;
  unit: MetricUnit | null;
  serviceKey: ServiceKey;
  current: number;
  previous: number | null;
  delta: Delta;
  series: { month: string; label: string; value: number }[];
}

export interface DashSection {
  serviceKey: ServiceKey;
  displayName: string;
  metrics: DashMetric[];
  /** The metric whose trend this section charts. */
  primary: DashMetric | null;
}

export interface DashboardData {
  hasData: boolean;
  currentMonthLabel: string | null;
  previousMonthLabel: string | null;
  summary: DashMetric[];
  sections: DashSection[];
}

/**
 * Load and shape a client's dashboard data. Always filters by client_id, so it
 * is correct both for a client (RLS already scopes them to their own rows) and
 * for an admin previewing a specific client (RLS lets admins read all, so the
 * explicit filter is what pins the preview to one client).
 */
export async function getClientDashboardData(
  supabase: SupabaseClient,
  clientId: string,
  monthsBack = 6,
): Promise<DashboardData> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
  const startIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: servicesData }, { data: metricsData }] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("client_id", clientId)
      .eq("enabled", true),
    supabase
      .from("metrics")
      .select("*")
      .eq("client_id", clientId)
      .gte("period_month", startIso)
      .order("period_month", { ascending: true }),
  ]);

  const services = (servicesData as Service[] | null) ?? [];
  const metrics = (metricsData as Metric[] | null) ?? [];

  const months = Array.from(new Set(metrics.map((m) => m.period_month))).sort();
  const currentMonth = months.at(-1) ?? null;
  const previousMonth = months.length >= 2 ? months[months.length - 2] : null;

  if (!currentMonth || metrics.length === 0) {
    return {
      hasData: false,
      currentMonthLabel: null,
      previousMonthLabel: null,
      summary: [],
      sections: [],
    };
  }

  // Group by service + metric, since the same metric_key (e.g. ad_spend) can
  // appear under more than one service.
  const byComposite = new Map<string, Metric[]>();
  for (const m of metrics) {
    const ck = `${m.service_key}::${m.metric_key}`;
    const arr = byComposite.get(ck) ?? [];
    arr.push(m);
    byComposite.set(ck, arr);
  }

  function buildDashMetric(rows: Metric[]): DashMetric {
    const key = rows[0].metric_key;
    const meta = metaFor(key);
    const sorted = [...rows].sort((a, b) =>
      a.period_month.localeCompare(b.period_month),
    );
    const cur = sorted.find((r) => r.period_month === currentMonth) ?? sorted.at(-1)!;
    const prevRow = previousMonth
      ? sorted.find((r) => r.period_month === previousMonth)
      : undefined;
    const previous = prevRow ? Number(prevRow.value) : null;
    const current = Number(cur.value);
    return {
      key,
      label: cur.label,
      unit: cur.unit,
      serviceKey: cur.service_key,
      current,
      previous,
      delta: computeDelta(current, previous, meta.better),
      series: sorted.map((r) => ({
        month: r.period_month,
        label: monthLabel(r.period_month, true),
        value: Number(r.value),
      })),
    };
  }

  const allMetrics: DashMetric[] = [];
  for (const rows of byComposite.values()) {
    allMetrics.push(buildDashMetric(rows));
  }

  // Headline metrics for the top cards, deduped by metric_key so a metric that
  // spans two services doesn't show twice.
  const seen = new Set<string>();
  const summary = allMetrics
    .filter((m) => metaFor(m.key).headline)
    .sort((a, b) => metaFor(a.key).order - metaFor(b.key).order)
    .filter((m) => {
      if (seen.has(m.key)) return false;
      seen.add(m.key);
      return true;
    })
    .slice(0, 5);

  const sections: DashSection[] = services
    .map((svc) => {
      const svcMetrics = allMetrics
        .filter((m) => m.serviceKey === svc.service_key)
        .sort((a, b) => metaFor(a.key).order - metaFor(b.key).order);
      const primary =
        svcMetrics.find((m) => metaFor(m.key).headline) ?? svcMetrics[0] ?? null;
      return {
        serviceKey: svc.service_key,
        displayName: svc.display_name,
        metrics: svcMetrics,
        primary,
      };
    })
    .filter((s) => s.metrics.length > 0);

  return {
    hasData: true,
    currentMonthLabel: monthLabel(currentMonth),
    previousMonthLabel: previousMonth ? monthLabel(previousMonth) : null,
    summary,
    sections,
  };
}
