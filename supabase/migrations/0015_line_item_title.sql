-- =============================================================================
-- Hartwell Pulse — 0015 invoice line-item title
-- A short title per line, rendered bold above the description on the invoice for a
-- clearer, more persuasive read. Nullable + additive; existing lines (description
-- only) render exactly as before. Run after 0014.
-- =============================================================================

alter table public.invoice_line_items
  add column if not exists title text;
