// Client-safe report types + pure helpers. No server-only imports here, so this
// can be used from both the admin editor (client) and the server data layer.
import type {
  Client,
  MetricUnit,
  Report,
  ReportSection,
  ReportSectionKind,
} from "@/lib/types/database";
import type { Delta } from "@/lib/metrics";

export type ReportBlock =
  | {
      id: string;
      type: "metric";
      serviceKey: string;
      metricKey: string;
      chart: boolean;
    }
  | { id: string; type: "image"; path: string; caption: string };

export interface ReportSectionContent {
  blocks: ReportBlock[];
}

// What the editor sends back to the saveReport action.
export interface SectionInput {
  kind: ReportSectionKind;
  title: string;
  body: string;
  blocks: ReportBlock[];
}

export interface SaveReportInput {
  title: string;
  sections: SectionInput[];
}

// A metric resolved for a specific report month (this month vs the one before).
export interface ReportMetric {
  serviceKey: string;
  metricKey: string;
  label: string;
  unit: MetricUnit | null;
  current: number;
  previous: number | null;
  delta: Delta;
  series: { label: string; value: number }[];
}

export interface AvailableMetric {
  serviceKey: string;
  serviceName: string;
  metricKey: string;
  label: string;
}

export interface ReportBundle {
  report: Report;
  client: Client;
  sections: ReportSection[];
  metrics: Record<string, ReportMetric>;
  available: AvailableMetric[];
}

export function metricKeyOf(serviceKey: string, metricKey: string): string {
  return `${serviceKey}::${metricKey}`;
}

export function sectionBlocks(section: ReportSection): ReportBlock[] {
  const content = section.content as ReportSectionContent | null;
  return content?.blocks ?? [];
}
