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

/**
 * Lives here rather than beside the sender because the editor needs it too,
 * and reports-send.ts is server-only.
 */
export const DEFAULT_REPORT_EMAIL =
  "Hi {name},\n\nYour {month} report is ready to read in the portal. It covers how things went last month and what I am working on next.\n\nHave a read when you get a moment, and tell me anything you want looked at more closely.\n\nThanks,\nKyle";

export interface SaveReportInput {
  title: string;
  /** The opening block, above the first section. Markdown, same subset. */
  summary: string;
  recipient_user_ids: string[];
  email_message: string;
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

/**
 * Placeholders left in a draft: "[ADD: PageSpeed scores]", "TODO", "TBC", "XXX".
 *
 * A report is written before all its numbers are in, and the gaps get marked
 * so they can be found again. The one time they will not be found again is the
 * moment of sending, which is the only moment it matters. Cheap to check, and
 * the alternative is a client reading a square bracket.
 */
export function findPlaceholders(input: {
  summary: string;
  sections: { title: string; body: string }[];
}): string[] {
  const found: string[] = [];
  const scan = (where: string, text: string) => {
    if (!text) return;
    // Square brackets holding a note to self, or a bare marker word.
    const re = /\[[^\]\n]{2,80}\]|\b(TODO|TBC|TBD|XXX|FIXME)\b/gi;
    for (const m of text.match(re) ?? []) {
      // A markdown link "[label](url)" is real content, not a gap.
      if (m.startsWith("[") && text.includes(`${m}(`)) continue;
      found.push(`${where}: ${m.length > 60 ? `${m.slice(0, 57)}...` : m}`);
    }
  };
  scan("Opening", input.summary);
  for (const s of input.sections) scan(s.title || "Untitled section", s.body);
  return found;
}

export function sectionPageBreak(section: ReportSection): boolean {
  const content = section.content as ReportSectionContent | null;
  return content?.pageBreak === true;
}
