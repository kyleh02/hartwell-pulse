/**
 * Shared CRM vocabulary: pipeline stages, outcomes and the Ironpeak accent.
 * Imported by both server and client components, so it stays free of any
 * Supabase or Node imports.
 */

export type CrmStage =
  | "researched"
  | "verified"
  | "contacted"
  | "connected"
  | "followed_up"
  | "replied"
  | "conversation"
  | "proposal"
  | "won"
  | "delivered"
  | "lost"
  | "do_not_contact";

export interface StageDef {
  key: CrmStage;
  label: string;
  hint: string;
}

/** The working pipeline, in order. Terminals are held separately. */
export const CRM_STAGES: StageDef[] = [
  { key: "researched", label: "Researched", hint: "Grant data captured, nothing verified yet" },
  { key: "verified", label: "Verified", hint: "Site checked, contact named, published address evidenced" },
  { key: "contacted", label: "Contacted", hint: "Email 1 sent" },
  { key: "connected", label: "Connected", hint: "LinkedIn request sent, an hour or two after email 1" },
  { key: "followed_up", label: "Followed up", hint: "Email 2 sent, day 8 to 10" },
  { key: "replied", label: "Replied", hint: "Any reply. Substantive is flagged separately" },
  { key: "conversation", label: "Conversation", hint: "A real back and forth is under way" },
  { key: "proposal", label: "Proposal", hint: "Scope and price with them" },
  { key: "won", label: "Won", hint: "Agreed, ready to deliver" },
  { key: "delivered", label: "Delivered", hint: "Work handed over" },
];

export const CRM_TERMINALS: StageDef[] = [
  { key: "lost", label: "Lost", hint: "Not proceeding" },
  { key: "do_not_contact", label: "Do not contact", hint: "Negative reply, bounce or opt-out. Permanent" },
];

export const ALL_STAGES: StageDef[] = [...CRM_STAGES, ...CRM_TERMINALS];

export function stageLabel(key: string): string {
  return ALL_STAGES.find((s) => s.key === key)?.label ?? key;
}

export const TIER_HINT: Record<string, string> = {
  A: "Highest grant value, strongest fit",
  B: "Strong fit",
  C: "Possible fit",
  D: "Lower priority",
};

export type TouchOutcome =
  | "none"
  | "reply_positive"
  | "reply_neutral"
  | "reply_negative"
  | "bounce"
  | "opt_out";

export const OUTCOME_LABEL: Record<TouchOutcome, string> = {
  none: "No reply yet",
  reply_positive: "Positive reply",
  reply_neutral: "Neutral reply",
  reply_negative: "Negative reply",
  bounce: "Bounced",
  opt_out: "Opted out",
};

/** Outcomes that permanently stop all outreach to the organisation. */
export const STOPPING_OUTCOMES: TouchOutcome[] = [
  "reply_negative",
  "bounce",
  "opt_out",
];

export const SEQUENCE_LABEL: Record<string, string> = {
  email_1: "Email 1",
  linkedin_connect: "LinkedIn connect",
  email_2: "Email 2",
  ad_hoc: "Ad hoc",
  inbound: "Inbound",
};

/** Day 8 to 10 after email 1; 9 sits in the middle of the window. */
export const FOLLOW_UP_DAYS = 9;

/**
 * The compliance fields that must be present before an outbound email can be
 * logged. Mirrors the database trigger in migration 0022, so the UI can grey
 * the button out and say why rather than letting Postgres raise.
 */
export interface ComplianceCheckable {
  email_as_published: string | null;
  email_source_url: string | null;
  email_verified_at: string | null;
  consent_basis: string;
  relevance_note: string | null;
  opt_out_at: string | null;
}

export function complianceGaps(c: ComplianceCheckable | null): string[] {
  if (!c) return ["No contact recorded yet"];
  const gaps: string[] = [];
  if (c.opt_out_at) return ["This contact has opted out. Outreach is closed."];
  if (!c.email_as_published?.trim()) gaps.push("Published email address");
  if (!c.email_source_url?.trim()) gaps.push("Source URL it was published at");
  if (!c.email_verified_at) gaps.push("Date the address was verified");
  if (c.consent_basis === "none") gaps.push("Consent basis");
  if (!c.relevance_note?.trim()) gaps.push("Relevance note");
  return gaps;
}

/** Warn before sending on evidence older than this. Websites change. */
export function isStale(verifiedAt: string | null, days = 14): boolean {
  if (!verifiedAt) return true;
  return Date.now() - new Date(verifiedAt).getTime() > days * 86_400_000;
}

export function formatAud(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}
