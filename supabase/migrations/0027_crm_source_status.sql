-- =============================================================================
-- Hartwell Pulse - 0027 CRM: qualification status and next action
--
-- The pipeline master carries Kyle's own working vocabulary for where a company
-- sits before outreach starts: skip, watch, queued, advance-queued, contacted.
-- That is a different axis from the pipeline stage, which tracks the outreach
-- sequence itself, so it gets its own column rather than being flattened into
-- the stage enum and losing the distinction between "queued" and "next up".
--
-- next_action holds the one line that says what to do about them, or why they
-- were ruled out. Keeping a skipped company with its reason is the point: it is
-- what stops the same business being researched again in three months.
-- Run after 0026. Idempotent.
-- =============================================================================

alter table public.crm_organisations
  add column if not exists source_status text,
  add column if not exists next_action text;

create index if not exists crm_org_source_status_idx
  on public.crm_organisations (source_status);
