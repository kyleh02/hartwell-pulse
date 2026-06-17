-- =============================================================================
-- Hartwell Pulse — 0007 client lifecycle
-- Adds soft-delete markers to clients so a deletion can be undone for 30 days
-- before a daily job purges the client's PORTAL data (never their invoices).
-- "Inactive" reuses the existing status value 'paused' — no enum change needed.
-- Run after 0001-0006.
-- =============================================================================

alter table public.clients
  add column if not exists deleted_at timestamptz,  -- soft-deleted; restorable for 30 days
  add column if not exists purged_at timestamptz;   -- set once the 30-day purge has run

-- Speeds up the "recently deleted" filter and the purge sweep.
create index if not exists clients_deleted_at_idx on public.clients(deleted_at);
