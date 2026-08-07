// =============================================================================
// Hartwell Pulse — database row types
// These mirror the Supabase schema in /supabase/migrations. Keep them in sync.
// Column names match the SQL exactly so queries stay honest.
// =============================================================================

export type Role = "admin" | "client";

export type ClientStatus = "onboarding" | "active" | "paused";

export type ServiceKey =
  | "google_ads"
  | "meta_ads"
  | "email"
  | "linkedin_ads"
  | "website";

export type ConnectionStatus = "connected" | "disconnected" | "error";

export type MetricUnit = "count" | "aud" | "percent" | "ratio" | "seconds";

export type ReportStatus = "draft" | "published";

export type ReportSectionKind =
  | "metrics"
  | "insights"
  | "recommendations"
  | "custom";

export type AssetKind = "image" | "document" | "copy" | "other";

export type AssetStatus = "draft" | "approved" | "ready" | "urgent";

export type BoardColumn = "pending" | "in_progress" | "delivered";

export type NotificationType =
  | "message"
  | "report_ready"
  | "asset_feedback"
  | "asset_uploaded"
  | "status_change"
  | "invoice";

export type NotificationChannel = "instant" | "digest" | "in_portal";

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export type GstMode = "add" | "inclusive" | "none";

export interface Client {
  id: string;
  business_name: string;
  slug: string;
  logo_url: string | null;
  service_tier: string;
  status: ClientStatus;
  created_at: string;
  deleted_at: string | null;
  purged_at: string | null;
}

export interface ClientUser {
  id: string;
  clerk_user_id: string;
  client_id: string | null; // null for admin
  role: Role;
  full_name: string | null;
  email: string | null;
  created_at: string;
}

export interface Service {
  id: string;
  client_id: string;
  service_key: ServiceKey;
  display_name: string;
  enabled: boolean;
  created_at: string;
}

export interface ApiConnection {
  id: string;
  client_id: string;
  provider: string;
  status: ConnectionStatus;
  external_account_id: string | null;
  credentials: Record<string, unknown> | null; // store encrypted in production
  connected_at: string | null;
  created_at: string;
}

export interface Metric {
  id: string;
  client_id: string;
  service_key: ServiceKey;
  metric_key: string;
  label: string;
  value: number;
  unit: MetricUnit | null;
  period_month: string; // first day of month, ISO date
  created_at: string;
}

export interface Report {
  id: string;
  client_id: string;
  period_month: string;
  title: string;
  status: ReportStatus;
  /** Which letterhead the report is dressed in. See src/lib/brand.ts. */
  brand: Brand;
  template_key: string | null;
  summary: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportSection {
  id: string;
  report_id: string;
  client_id: string;
  kind: ReportSectionKind;
  title: string;
  body: string | null;
  content: Record<string, unknown> | null;
  position: number;
  created_at: string;
}

export interface InsightSnippet {
  id: string;
  owner_user_id: string;
  category: string | null;
  title: string;
  body: string;
  created_at: string;
}

export interface Asset {
  id: string;
  client_id: string;
  uploaded_by: string;
  uploader_role: Role;
  name: string;
  storage_path: string;
  file_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  kind: AssetKind;
  folder: string | null;
  folder_id: string | null;
  thumb_path: string | null;
  locked: boolean;
  tags: string[];
  status: AssetStatus | null;
  created_at: string;
}

export interface AssetFolder {
  id: string;
  client_id: string;
  parent_id: string | null;
  name: string;
  client_editable: boolean;
  created_by: string | null;
  created_at: string;
}

export interface Share {
  id: string;
  client_id: string;
  asset_id: string | null;
  folder_id: string | null;
  created_by: string;
  access: "view";
  require_login: boolean;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
}

export type CopyDocStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "changes_requested";

export interface CopyDocument {
  id: string;
  client_id: string;
  folder_id: string | null;
  title: string;
  body_json: unknown;
  body_html: string | null;
  review_note: string | null;
  status: CopyDocStatus;
  created_by: string;
  updated_at: string;
  created_at: string;
}

export interface CopyDocumentVersion {
  id: string;
  document_id: string;
  body_json: unknown;
  label: string | null;
  created_by: string;
  created_at: string;
}

export interface AssetComment {
  id: string;
  asset_id: string;
  client_id: string;
  author_user_id: string;
  author_role: Role;
  body: string;
  created_at: string;
}

export type ConversationKind = "direct" | "group";

export interface Conversation {
  id: string;
  client_id: string;
  kind: ConversationKind;
  direct_user_id: string | null; // the client user of a 'direct' thread
  title: string | null; // group threads only
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface ConversationMember {
  conversation_id: string;
  clerk_user_id: string;
  last_read_at: string | null; // the read receipt
  created_at: string;
}

export interface Message {
  id: string;
  client_id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_role: Role;
  body: string;
  attachments: Record<string, unknown>[] | null;
  read_at: string | null;
  edited_at: string | null;
  created_at: string;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  client_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

// ---------- CRM (Ironpeak outreach). Admin only; clients never see these. ----
export type CrmPlatform = "wordpress" | "wix" | "squarespace" | "custom" | "unknown";
export type CrmRoleSource = "own_site" | "trade_press" | "linkedin" | "referral";
export type CrmConsentBasis = "inferred_published" | "express" | "referral" | "none";
export type CrmChannel = "email" | "linkedin_note" | "linkedin_message" | "reply" | "meeting";
export type CrmSequenceStep = "email_1" | "linkedin_connect" | "email_2" | "ad_hoc" | "inbound";
export type CrmTaskKind = "follow_up" | "linkedin_connect" | "reverify" | "annual_review" | "manual";

export interface CrmList {
  id: string;
  brand: string;
  slug: string;
  name: string;
  description: string | null;
  source_note: string | null; // where the names came from, and when
  captured_on: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface CrmOrganisation {
  id: string;
  brand: string; // 'ironpeak' today; the column exists so Hartwell can share
  list_id: string | null; // which source list this prospect came from
  legal_name: string;
  trading_name: string | null;
  abn: string | null;
  state: string | null;
  website_url: string | null;
  domain: string | null;
  platform: CrmPlatform;
  sector_tags: string[];
  employee_estimate: number | null;
  established_year: number | null;
  tier: string | null; // A to D
  research_file_path: string | null;
  last_verified_at: string | null;
  grant_total_aud: number;
  grant_count: number;
  grant_streams: string[];
  new_capability: boolean;
  headline_purpose: string | null;
  /** Kyle's qualification vocabulary: skip | watch | queued | advance-queued. */
  source_status: string | null;
  next_action: string | null;
  stage: string;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmGrant {
  id: string;
  organisation_id: string;
  amount: number;
  stream: string | null;
  purpose: string | null; // the public sentence: what they were funded to build
  created_at: string;
}

export interface CrmContact {
  id: string;
  organisation_id: string;
  first_name: string | null;
  surname: string | null;
  role_title: string | null;
  role_source: CrmRoleSource | null;
  role_verified_at: string | null;
  role_confirmed: boolean;
  email_as_published: string | null; // verbatim, never normalised
  email_source_url: string | null;
  email_verified_at: string | null;
  direct_email: string | null; // given once you are talking; never overwrites the above
  phone: string | null;
  screenshot_path: string | null;
  linkedin_url: string | null;
  no_opt_out_notice: boolean;
  consent_basis: CrmConsentBasis;
  relevance_note: string | null;
  is_sole_contact_for_org: boolean;
  opt_out_at: string | null;
  opt_out_actioned_at: string | null;
  opt_out_channel: string | null;
  opt_out_verbatim: string | null;
  created_at: string;
}

export interface CrmTouch {
  id: string;
  contact_id: string;
  organisation_id: string;
  channel: CrmChannel;
  sequence_step: CrmSequenceStep;
  direction: "out" | "in";
  sent_at: string;
  subject: string | null;
  body_snapshot: string | null; // what was actually sent, not the template
  outcome: string;
  substantive: boolean;
  presend_checks: Record<string, unknown>;
  created_at: string;
}

export interface CrmResearch {
  id: string;
  organisation_id: string;
  verified_on: string | null;
  lead_finding: string | null;
  lead_finding_method: string | null;
  technical_domain_finding: string | null; // the send gate
  positive_finding: string | null; // also required before a first email
  keep_out_of_first_email: string | null;
  blocker: string | null;
  seven_questions: Record<string, unknown>[];
  signals: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CrmTask {
  id: string;
  organisation_id: string | null;
  contact_id: string | null;
  kind: CrmTaskKind;
  title: string;
  due_on: string; // ISO date
  done_at: string | null;
  notified_at: string | null;
  created_at: string;
}

export interface CrmSettings {
  id: boolean;
  daily_contact_goal: number;
  weekly_contact_goal: number;
  capacity_engagement_limit: number;
  abort_warning_sends: number;
  reverify_after_days: number;
  updated_at: string;
}

export interface CrmMetrics {
  sent: number;
  replies: number;
  substantive: number;
  opt_outs: number;
  sent_today: number;
  live_engagements: number;
  sends_since_substantive: number;
}

export interface Notification {
  id: string;
  recipient_user_id: string;
  client_id: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  channel: NotificationChannel;
  emailed_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface BusinessSettings {
  id: number;
  business_name: string;
  abn: string | null;
  address: string | null;
  email_from: string | null;
  bank_name: string | null;
  bank_bsb: string | null;
  bank_account: string | null;
  payment_terms_days: number;
  reminder_days_before: number; // heads-up before due; 0 disables
  gst_mode: GstMode;
  invoice_email_message: string | null;
  updated_at: string;
}

export interface PricingItem {
  id: string;
  category: string;
  name: string;
  tier: string | null;
  description: string | null;
  default_amount: number;
  active: boolean;
  position: number;
  created_at: string;
}

/**
 * Which trading brand a document is issued under. Same legal entity and ABN
 * either way; only the letterhead changes. Invoices and reports share it.
 */
export type Brand = "hartwell" | "ironpeak";
export type InvoiceBrand = Brand;

export interface Invoice {
  id: string;
  client_id: string;
  invoice_number: string;
  brand: InvoiceBrand;
  /**
   * Clerk user ids this invoice and its reminders go to. EMPTY MEANS EVERYONE
   * on the client account — see migration 0031. Never treat empty as "nobody".
   */
  recipient_user_ids: string[];
  deposit_amount: number; // already received, credited against the total
  deposit_label: string | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  gst_mode: GstMode;
  subtotal: number;
  discount: number;
  discount_label: string | null;
  gst: number;
  total: number;
  notes: string | null;
  created_by: string | null;
  sent_at: string | null;
  paid_at: string | null;
  recurring: boolean;
  reminder_sent_at: string | null;
  pre_reminder_sent_at: string | null;
  email_message: string | null;
  recurring_active: boolean | null;
  recurring_anchor_day: number | null;
  recurring_terms_days: number | null; // null = use the business default
  recurring_source_id: string | null;
  recurring_period: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  client_id: string;
  title: string | null;
  description: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  position: number;
}

export interface BoardCard {
  id: string;
  client_id: string | null;
  title: string;
  description: string | null;
  column_key: BoardColumn;
  card_type: string;
  position: number;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
