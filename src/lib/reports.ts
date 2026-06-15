import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Client,
  Metric,
  Report,
  ReportSection,
  Service,
  InsightSnippet,
} from "@/lib/types/database";
import { computeDelta, metaFor, monthLabel } from "@/lib/metrics";
import {
  metricKeyOf,
  type ReportMetric,
  type AvailableMetric,
  type ReportBundle,
} from "@/lib/reports-shared";

function shiftMonth(iso: string, delta: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const nd = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Resolve every metric for a client as of a given report month. */
export async function getReportMetricData(
  supabase: SupabaseClient,
  clientId: string,
  periodMonth: string,
  monthsBack = 6,
): Promise<Record<string, ReportMetric>> {
  const startIso = shiftMonth(periodMonth, -(monthsBack - 1));
  const prevIso = shiftMonth(periodMonth, -1);

  const { data } = await supabase
    .from("metrics")
    .select("*")
    .eq("client_id", clientId)
    .gte("period_month", startIso)
    .lte("period_month", periodMonth)
    .order("period_month", { ascending: true });

  const rows = (data as Metric[] | null) ?? [];

  const grouped = new Map<string, Metric[]>();
  for (const r of rows) {
    const k = metricKeyOf(r.service_key, r.metric_key);
    const arr = grouped.get(k) ?? [];
    arr.push(r);
    grouped.set(k, arr);
  }

  const out: Record<string, ReportMetric> = {};
  for (const [k, group] of grouped) {
    const sorted = [...group].sort((a, b) =>
      a.period_month.localeCompare(b.period_month),
    );
    const curRow =
      sorted.find((r) => r.period_month === periodMonth) ?? sorted.at(-1)!;
    const prevRow = sorted.find((r) => r.period_month === prevIso);
    const current = Number(curRow.value);
    const previous = prevRow ? Number(prevRow.value) : null;
    out[k] = {
      serviceKey: curRow.service_key,
      metricKey: curRow.metric_key,
      label: curRow.label,
      unit: curRow.unit,
      current,
      previous,
      delta: computeDelta(current, previous, metaFor(curRow.metric_key).better),
      series: sorted.map((r) => ({
        label: monthLabel(r.period_month, true),
        value: Number(r.value),
      })),
    };
  }
  return out;
}

/** Everything the editor and viewer need for one report. */
export async function getReportBundle(
  supabase: SupabaseClient,
  reportId: string,
): Promise<ReportBundle | null> {
  const { data: reportRow } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (!reportRow) return null;
  const report = reportRow as Report;

  const [{ data: clientRow }, { data: sectionRows }, { data: serviceRows }] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", report.client_id).maybeSingle(),
      supabase
        .from("report_sections")
        .select("*")
        .eq("report_id", reportId)
        .order("position", { ascending: true }),
      supabase
        .from("services")
        .select("*")
        .eq("client_id", report.client_id)
        .eq("enabled", true),
    ]);

  if (!clientRow) return null;

  const metrics = await getReportMetricData(
    supabase,
    report.client_id,
    report.period_month,
  );

  const services = (serviceRows as Service[] | null) ?? [];
  const serviceName = new Map<string, string>(
    services.map((s) => [s.service_key, s.display_name] as [string, string]),
  );

  const available: AvailableMetric[] = Object.values(metrics)
    .map((m) => ({
      serviceKey: m.serviceKey,
      serviceName: serviceName.get(m.serviceKey) ?? m.serviceKey,
      metricKey: m.metricKey,
      label: m.label,
    }))
    .sort(
      (a, b) =>
        a.serviceName.localeCompare(b.serviceName) ||
        metaFor(a.metricKey).order - metaFor(b.metricKey).order,
    );

  return {
    report,
    client: clientRow as Client,
    sections: (sectionRows as ReportSection[] | null) ?? [],
    metrics,
    available,
  };
}

export type AdminReportRow = Report & { client_name: string };

export async function listAdminReports(
  supabase: SupabaseClient,
): Promise<AdminReportRow[]> {
  const { data } = await supabase
    .from("reports")
    .select("*, clients(business_name)")
    .order("period_month", { ascending: false });
  const rows =
    (data as (Report & { clients: { business_name: string } | null })[] | null) ??
    [];
  return rows.map((r) => ({
    ...r,
    client_name: r.clients?.business_name ?? "Unknown",
  }));
}

export async function listClientReports(
  supabase: SupabaseClient,
  clientId: string,
): Promise<Report[]> {
  const { data } = await supabase
    .from("reports")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "published")
    .order("period_month", { ascending: false });
  return (data as Report[] | null) ?? [];
}

export async function listSnippets(
  supabase: SupabaseClient,
): Promise<InsightSnippet[]> {
  const { data } = await supabase
    .from("insight_snippets")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as InsightSnippet[] | null) ?? [];
}

/** Resolve image-block storage paths to short-lived signed URLs. */
export async function resolveImageUrls(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths)).filter(Boolean);
  if (unique.length === 0) return {};
  const { data } = await supabase.storage
    .from("pulse-reports")
    .createSignedUrls(unique, 60 * 60);
  const out: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  }
  return out;
}
