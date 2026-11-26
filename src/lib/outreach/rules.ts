/**
 * Draper's fixed vocabularies.
 *
 * Each list mirrors a check constraint in supabase/migrations/0062_draper.sql,
 * and schema.test.ts fails if the two drift apart: a value the code writes
 * that the database refuses is a send that silently never happens.
 *
 * Pure data, no imports, so the test runner and the browser can both load it.
 */

/**
 * The faults Pulse measures. Nothing else is ever claimed. The first six are
 * 0062's; the last three are 0067's (Kyle, 21 Nov 2026), added after the first
 * morning run found that most sites in the 4WD lane are only slow, so the
 * two-fault rule let nothing through. The last two are 0071's (Kyle, 27 Nov
 * 2026): the paper test found that ads running to a site that can't measure
 * them is the one finding strong enough to write about. All eleven come from
 * the one measurement and none needs a form sent.
 */
export const FAULTS = [
  "slow_mobile",
  "broken_page",
  "not_secure",
  "phone_not_tappable",
  "pixel_double",
  "old_analytics",
  "layout_shift",
  "page_freezes",
  "no_mobile_layout",
  "no_meta_pixel",
  "no_google_tag",
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
  layout_shift: "Jumps around while loading",
  page_freezes: "Freezes after it appears",
  no_mobile_layout: "Not set up for phones",
  no_meta_pixel: "No Meta Pixel",
  no_google_tag: "No Google tag",
};

/**
 * The tracking gaps (template 4, give-first, 27 November 2026): a site that
 * can't measure the ads sent to it. Only these lead a give-first email, and
 * only on a platform the business's ads run on.
 */
export const TRACKING_GAPS: readonly Fault[] = ["no_meta_pixel", "no_google_tag", "pixel_double"];

/**
 * Which fault an email leads with (Kyle, 22 November 2026: tracking faults
 * above speed). The ads template's first email must be about the best-ranked
 * fault on record: what touches the numbers their ads are judged by first,
 * then what a paid visitor meets on arrival, then speed and layout.
 */
export const FAULT_RANK: readonly Fault[] = [
  "no_meta_pixel",
  "no_google_tag",
  "pixel_double",
  "old_analytics",
  "not_secure",
  "broken_page",
  "phone_not_tappable",
  "slow_mobile",
  "no_mobile_layout",
  "page_freezes",
  "layout_shift",
];

/** The best-ranked of some faults, or null. */
export function bestFault(faults: readonly Fault[]): Fault | null {
  return FAULT_RANK.find((f) => faults.includes(f)) ?? null;
}

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
