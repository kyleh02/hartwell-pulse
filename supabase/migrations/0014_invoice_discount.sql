-- =============================================================================
-- Hartwell Pulse — 0014 invoice discount
-- An optional fixed-dollar discount per invoice, shown as its own row in the
-- totals (Subtotal -> Discount -> Total) and applied before GST. Additive and
-- defaulting to 0, so existing invoices are unchanged. Run after 0013.
-- =============================================================================

alter table public.invoices
  add column if not exists discount numeric not null default 0,
  add column if not exists discount_label text;
