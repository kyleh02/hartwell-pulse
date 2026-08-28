-- =============================================================================
-- 0045 — one notification type for the morning brief
--
-- The brief is the only notification Kyle's own work is allowed to send: one
-- line each morning saying what is due and what is late, linking to the list
-- where everything has a button.
--
-- What it replaces is `crm_reminder`, which fired once per due task with no
-- way to answer any of them, so the same nine arrived again the next morning.
-- That type stays in the constraint because rows carrying it still exist and a
-- check constraint is validated against the whole table.
--
-- Run after 0044. Idempotent.
-- =============================================================================

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'message', 'report_ready', 'asset_feedback', 'asset_uploaded',
    'status_change', 'invoice', 'crm_reminder', 'work_brief'
  ));
