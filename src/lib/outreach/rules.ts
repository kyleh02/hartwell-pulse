/**
 * Draper's fixed vocabularies.
 *
 * Each list mirrors a check constraint in supabase/migrations/0062_draper.sql,
 * and schema.test.ts fails if the two drift apart: a value the code writes
 * that the database refuses is a send that silently never happens.
 *
 * Pure data, no imports, so the test runner and the browser can both load it.
 */

/** The six faults Pulse measures. Nothing else is ever claimed. */
export const FAULTS = [
  "slow_mobile",
  "broken_page",
  "not_secure",
  "phone_not_tappable",
  "pixel_double",
  "old_analytics",
] as const;
export type Fault = (typeof FAULTS)[number];

/** How each fault is named on Kyle's pages. Never used in an email. */
export const FAULT_LABEL: Record<Fault, string> = {
  slow_mobile: "Slow on a phone",
  broken_page: "Broken page",
  not_secure: "Not secure",
  phone_not_tappable: "Phone number can't be tapped",
  pixel_double: "Meta Pixel counted twice",
  old_analytics: "Old Google Analytics only",
};

export const PROSPECT_STATUSES = [
  "found",
  "measured",
  "dropped",
  "queued",
  "sent",
  "followed_up",
  "replied",
  "later",
  "closed",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

/**
 * A submitted message waits as awaiting_confirmation until Pulse has measured
 * its fault again an hour or more later (decision 3). "sending" is the claim
 * the tick takes before it calls Gmail, so two ticks never send one message.
 */
export const MESSAGE_STATUSES = [
  "awaiting_confirmation",
  "queued",
  "sending",
  "sent",
  "dropped",
  "cancelled",
  "expired",
  "failed",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_KINDS = ["first", "follow_up"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const REPLY_LABELS = [
  "interested",
  "question",
  "later",
  "sorted",
  "no_thanks",
  "wrong_fact",
  "complaint",
  "other",
] as const;
export type ReplyLabel = (typeof REPLY_LABELS)[number];

export const REPLY_LABEL: Record<ReplyLabel, string> = {
  interested: "Interested",
  question: "Question",
  later: "Later",
  sorted: "Sorted",
  no_thanks: "No thanks",
  wrong_fact: "Wrong fact",
  complaint: "Complaint",
  other: "Other",
};

export const REPLY_KINDS = ["reply", "bounce", "auto_reply", "opt_out"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export const EVENT_KINDS = [
  "found",
  "measured",
  "dropped",
  "submitted",
  "refused",
  "confirmed",
  "queued",
  "approved",
  "checked",
  "cancelled",
  "expired",
  "sent",
  "followed_up",
  "bounced",
  "replied",
  "labelled",
  "opted_out",
  "suppressed",
  "lead_created",
  "auto_paused",
  "paused",
  "resumed",
  "fault_off",
  "fault_on",
  "purged",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const FINGERPRINT_KINDS = ["domain", "abn", "name", "email", "phone"] as const;
export type FingerprintKind = (typeof FINGERPRINT_KINDS)[number];

export const FINGERPRINT_REASONS = ["contacted", "opted_out", "imported", "do_not_contact"] as const;
export type FingerprintReason = (typeof FINGERPRINT_REASONS)[number];

export const MEASUREMENT_PURPOSES = ["initial", "confirm", "pre_send", "follow_up", "manual"] as const;
export type MeasurementPurpose = (typeof MEASUREMENT_PURPOSES)[number];

export const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;
export type AuState = (typeof AU_STATES)[number];

/**
 * Lane 4, defence, is left out of this build (decision 8): Ironpeak trades in
 * defence under the same ABN. The database refuses the row as well.
 */
export const DEFENCE_LANE = 4;
