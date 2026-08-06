-- =============================================================================
-- Hartwell Pulse - 0029 recurring: per-template payment terms
--
-- Recurring billing already materialises and auto-sends one invoice per
-- template per month. It took the due date from the global default terms in
-- business settings, which is fine until one retainer bills on different terms
-- from everything else. A hosting retainer on 7 days should not force every
-- other invoice off 14.
--
-- Null means "use the business default", so nothing changes for existing
-- templates.
-- Run after 0028. Idempotent.
-- =============================================================================

alter table public.invoices
  add column if not exists recurring_terms_days integer;
