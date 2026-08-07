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
  /**
   * Force this section to start at the top of a fresh page in print / PDF.
   *
   * CSS can stop a heading being orphaned or a table row being sliced in half,
   * but it cannot know that a section is a new chapter. This is the one
   * judgement only the writer can make, so it is a switch rather than a
   * heuristic. It lives in the section's JSON content, which is why it needed
   * no migration.
   */
  pageBreak?: boolean;
}

// What the editor sends back to the saveReport action.
export interface SectionInput {
  kind: ReportSectionKind;
  title: string;
  body: string;
  blocks: ReportBlock[];
  pageBreak: boolean;
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

export function sectionPageBreak(section: ReportSection): boolean {
  const content = section.content as ReportSectionContent | null;
  return content?.pageBreak === true;
}
