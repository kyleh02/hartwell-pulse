-- =============================================================================
-- Hartwell Pulse - 0028 invoice reminders before the due date
--
-- Overdue chasing already exists and works: a weekly nudge to the client until
-- the invoice is paid. What was missing is the reminder that actually prevents
-- lateness rather than chasing it afterwards, a few days BEFORE the due date,
-- while paying is still just admin rather than an apology.
--
-- Also adds an admin alert when an invoice tips overdue. Until now the client
-- was told and Kyle was not, so the first he knew of it was noticing on the
-- invoices page.
-- Run after 0027. Idempotent.
-- =============================================================================

alter table public.business_settings
  -- 0 disables the pre-due reminder entirely.
  add column if not exists reminder_days_before integer not null default 3;

alter table public.invoices
  add column if not exists pre_reminder_sent_at timestamptz;

-- Only ever one pre-due reminder per invoice, so the index is just for the
-- daily sweep to find candidates cheaply.
create index if not exists invoices_due_unpaid_idx
  on public.invoices (due_date)
  where status = 'sent';
