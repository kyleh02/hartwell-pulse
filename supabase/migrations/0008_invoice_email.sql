-- =============================================================================
-- Hartwell Pulse — 0008 editable invoice email message
-- A default email body (business_settings) + a per-invoice override (invoices).
-- Both nullable; the app falls back to a built-in default. Run after 0007.
-- =============================================================================

alter table public.business_settings
  add column if not exists invoice_email_message text;

alter table public.invoices
  add column if not exists email_message text;
