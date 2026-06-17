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
  tags: string[];
  status: AssetStatus | null;
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

export interface Message {
  id: string;
  client_id: string;
  sender_user_id: string;
  sender_role: Role;
  body: string;
  attachments: Record<string, unknown>[] | null;
  read_at: string | null;
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

export interface Invoice {
  id: string;
  client_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  gst_mode: GstMode;
  subtotal: number;
  gst: number;
  total: number;
  notes: string | null;
  created_by: string | null;
  sent_at: string | null;
  paid_at: string | null;
  recurring: boolean;
  reminder_sent_at: string | null;
  email_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  client_id: string;
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
