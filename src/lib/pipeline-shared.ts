/**
 * The sales pipeline (0056): what the server, the browser and Claude's
 * connector all need. Kept small on purpose. The old outreach CRM had nine
 * pre-send checks and a dozen stages; this has six stages, a follow-up date
 * and a log, because Kyle never used the other one.
 */

export type LeadStage = "new" | "contacted" | "meeting" | "proposal" | "won" | "lost";
export type LeadSource = "website" | "quiz" | "audit" | "referral" | "manual" | "other";
export type ActivityKind = "created" | "note" | "call" | "email" | "meeting" | "stage" | "won" | "lost";

export interface Lead {
  id: string;
  name: string | null;
  business: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  source: LeadSource;
  service: string | null;
  value: number | null;
  stage: LeadStage;
  next_action: string | null;
  follow_up_on: string | null;
  notes: string | null;
  lost_reason: string | null;
  client_id: string | null;
  stage_changed_at: string;
  won_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  kind: ActivityKind;
  body: string | null;
  created_at: string;
}

/** The board's columns, in order. Won and lost sit apart from the open four. */
export const STAGES: { key: LeadStage; label: string; open: boolean }[] = [
  { key: "new", label: "New", open: true },
  { key: "contacted", label: "Contacted", open: true },
  { key: "meeting", label: "Meeting", open: true },
  { key: "proposal", label: "Proposal", open: true },
  { key: "won", label: "Won", open: false },
  { key: "lost", label: "Lost", open: false },
];

export const STAGE_LABEL: Record<LeadStage, string> = Object.fromEntries(
  STAGES.map((s) => [s.key, s.label]),
) as Record<LeadStage, string>;

export const SOURCE_LABEL: Record<LeadSource, string> = {
  website: "Website enquiry",
  quiz: "Website quiz",
  audit: "Audit page",
  referral: "Referral",
  manual: "Added by hand",
  other: "Other",
};

export function isLeadStage(s: string): s is LeadStage {
  return STAGES.some((x) => x.key === s);
}

export function isLeadSource(s: string): s is LeadSource {
  return s in SOURCE_LABEL;
}

/** Who a lead is, in one line. */
export function leadTitle(l: Pick<Lead, "business" | "name" | "email">): string {
  return l.business?.trim() || l.name?.trim() || l.email?.trim() || "Unnamed lead";
}

/** YYYY-MM-DD plus n days, as calendar dates (no time zone can move them). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The next Monday on or after tomorrow, for "next week". */
export function nextMonday(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

export function followUpState(l: Pick<Lead, "follow_up_on" | "stage">, today: string): "overdue" | "today" | "later" | "none" {
  if (!l.follow_up_on || l.stage === "won" || l.stage === "lost") return "none";
  if (l.follow_up_on < today) return "overdue";
  if (l.follow_up_on === today) return "today";
  return "later";
}

export function shortDate(date: string | null): string | null {
  if (!date) return null;
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function money(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  return Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}
