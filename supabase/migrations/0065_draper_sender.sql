-- =============================================================================
-- 0065: Draper, Stage 5. What the sender needs on top of 0062.
--
-- 1. A notification type for Draper: the 8am summary, sending problems and
--    (Stage 6) replies and auto-pauses. Same list as 0060 plus 'outreach'.
-- 2. Messages: when Pulse confirmed the fault (the second run an hour on),
--    how many times a send was tried, and the last error. A send that fails
--    goes back in the queue and is tried again, at most three times; before a
--    retry the sender asks Gmail whether the first try went after all, so an
--    email is never sent twice.
-- 3. The state row: the day the 8am queue was fixed and summarised, and when
--    the tick last ran, so the Draper page can say the tick is alive.
--
-- Safe to run more than once.
-- =============================================================================

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'message', 'report_ready', 'asset_feedback', 'asset_uploaded',
    'status_change', 'invoice', 'crm_reminder', 'work_brief',
    'approval', 'onboarding', 'nps', 'assistant', 'lead', 'outreach'
  ));

alter table public.outreach_messages
  add column if not exists confirmed_at timestamptz,
  add column if not exists send_attempts int not null default 0,
  add column if not exists send_error text;

alter table public.outreach_state
  add column if not exists queue_fixed_on date,
  add column if not exists tick_at timestamptz,
  add column if not exists tick_note text;

notify pgrst, 'reload schema';
