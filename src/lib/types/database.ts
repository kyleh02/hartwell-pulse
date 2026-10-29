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
  | "invoice"
  | "work_brief"
  | "approval"
  | "onboarding"
  | "nps"
  | "assistant"
  | "lead";

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
  /** Billing details for the Bill to block (0052). Optional until it is run. */
  legal_name?: string | null;
  /** Eleven digits, no spaces. */
  abn?: string | null;
  billing_address?: string | null;
  billing_attention?: string | null;
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
  /**
   * Clerk user ids this report goes to. EMPTY MEANS EVERYONE on the client
   * account, same rule as invoices — see src/lib/recipients.ts.
   */
  recipient_user_ids: string[];
  /** When it was actually emailed out, as opposed to merely published. */
  sent_at: string | null;
  email_message: string | null;
  template_key: string | null;
  summary: string | null;
  /**
   * The PDF that travels with the send email, in the `pulse-reports` bucket.
   *
   * Uploaded by Kyle from the printed viewer, not generated here. Null is a
   * normal state: the email still goes, it just carries a link only.
   */
  pdf_path: string | null;
  /** The filename the client sees, kept because the path carries a uuid. */
  pdf_name: string | null;
  /** Compare against updated_at. Older means the PDF is stale. */
  pdf_uploaded_at: string | null;
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

export type EmailStatus =
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "failed";

/** One row per address per email, moved along by the Resend webhook. */
export interface EmailEvent {
  id: string;
  provider_id: string | null;
  recipient: string;
  subject: string | null;
  ref_kind: "invoice" | "report" | "message" | "other" | null;
  ref_id: string | null;
  status: EmailStatus;
  detail: string | null;
  sent_at: string;
  updated_at: string;
}

/** One row per time an invoice was emailed, snapshotting what it said then. */
export interface InvoiceSend {
  id: string;
  invoice_id: string;
  client_id: string;
  revision: number;
  total: number;
  due_date: string | null;
  sent_to: string[];
  /** "scheduled" is the claim the instalment job makes before it sends (0050). */
  kind: "send" | "resend" | "scheduled";
  sent_at: string;
  sent_by: string | null;
  /** Every file the email carried, by name (0051). Empty on older rows. */
  attachment_names?: string[];
}

/** A document sent alongside an invoice's own PDF (0051). */
export interface InvoiceAttachment {
  id: string;
  invoice_id: string;
  client_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  position: number;
  created_at: string;
  created_by: string | null;
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
  /** Standard rate charged by the hour. Fills into new hourly invoices. */
  default_hourly_rate: number | null;
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

export type RateMode = "fixed" | "hourly";

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
  /** 0 as first issued; bumped each time an already-sent invoice is corrected. */
  revision: number;
  /** Last time it was emailed. `sent_at` stays the first send. */
  last_sent_at: string | null;
  deposit_amount: number; // already received, credited against the total
  deposit_label: string | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  gst_mode: GstMode;
  /**
   * "hourly" bills quantity as hours at an hourly rate. Presentation only: the
   * maths is quantity * unit_amount either way. See migration 0047.
   */
  rate_mode: RateMode;
  /** The Bill to block as issued (0052). Null on a draft, which shows the profile live. */
  bill_to?: unknown;
  /** Whether the PDF was made by the portal or uploaded by hand (0052). */
  pdf_source?: "generated" | "uploaded" | null;
  /**
   * The standard rate an hourly invoice bills at. Each line's unit_amount is
   * that line's own rate; this is the one the unoverridden lines follow, and
   * what the rate box is restored from. See migration 0048.
   */
  hourly_rate: number | null;
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
  /**
   * Instalments. Set on a CHILD: the invoice it was split out of, which part it
   * is, how many parts there are, and the day it should issue and email itself.
   */
  parent_invoice_id: string | null;
  instalment_number: number | null;
  instalment_count: number | null;
  scheduled_send_at: string | null;
  /**
   * Set on the PARENT when it is split. Non-null means superseded by its
   * instalments: excluded from every balance, and never chased.
   */
  split_at: string | null;
  split_note: string | null;
  split_by: string | null;
  recurring_period: string | null;
  created_at: string;
  updated_at: string;
  /**
   * The PDF that travels with the send email, in the `pulse-reports` bucket.
   *
   * Null is a normal state: the email still goes, it just carries a link only.
   * Compare pdf_uploaded_at against updated_at — older means it predates the
   * last edit, and on a reissued invoice that means superseded figures under
   * the same number.
   */
  pdf_path: string | null;
  pdf_name: string | null;
  pdf_uploaded_at: string | null;
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
  /** Groups lines under a shared heading. Null means the line is not phased. */
  phase_position: number | null;
  /** The heading, copied onto every line of the phase. */
  phase_title: string | null;
  /** Optional line under the heading, e.g. "Payable on commencement". */
  phase_note: string | null;
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
