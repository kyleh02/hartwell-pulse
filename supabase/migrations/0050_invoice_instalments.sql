-- =============================================================================
-- Hartwell Pulse — 0050 invoice instalments (split payments)
--
-- Splits an issued invoice into instalments that are each a tax invoice in
-- their own right: own number, own amount, own GST, own due date, own send
-- date.
--
-- Each instalment is a ROW IN invoices, not a row in a new table. That is the
-- whole design. A row inherits the PDF renderer, the print route, the send
-- path, the send history, the client portal view, RLS, numbering and the
-- reminder jobs. A separate table would mean reimplementing all of it, and
-- would be the thing that silently diverged.
--
-- Additive and nullable throughout: an invoice that is never split carries on
-- exactly as it does now. Run after 0049.
-- =============================================================================

alter table public.invoices
  -- Set on an INSTALMENT, pointing at the invoice it came out of. restrict, not
  -- cascade: deleting a parent out from under its instalments would leave them
  -- claiming to be part N of something that no longer exists.
  add column if not exists parent_invoice_id uuid references public.invoices(id) on delete restrict,
  add column if not exists instalment_number smallint,
  add column if not exists instalment_count smallint,
  -- The day this instalment should issue and email itself. Null on everything
  -- that is sent by hand.
  add column if not exists scheduled_send_at date,
  -- Set on the PARENT when it is split. This one column is the rule for double
  -- counting: non-null means superseded by its instalments, so the parent is
  -- excluded from every balance and never chased.
  add column if not exists split_at timestamptz,
  add column if not exists split_note text,
  add column if not exists split_by text;

-- Part 3 of 2 is not a thing. Dropped first because Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS and this file has to stay re-runnable.
alter table public.invoices drop constraint if exists invoices_instalment_range_check;
alter table public.invoices
  add constraint invoices_instalment_range_check check (
    instalment_number is null
    or (instalment_number >= 1 and instalment_count >= instalment_number)
  );

-- One part 2 per parent, enforced by the database rather than by whoever is
-- holding the mouse.
create unique index if not exists invoices_instalment_uniq
  on public.invoices (parent_invoice_id, instalment_number)
  where parent_invoice_id is not null;

-- What the scheduled send reads each morning.
create index if not exists invoices_scheduled_send_idx
  on public.invoices (scheduled_send_at)
  where scheduled_send_at is not null and status = 'draft';

-- ---------- the send claim ----------
-- The scheduled send must not fire twice if the job retries, the function is
-- replayed, or two runs overlap. The claim is an INSERT whose unique index
-- fails with 23505 on the second attempt, which is the same idiom the recurring
-- cron already relies on, rather than reading a timestamp and hoping the gap
-- between read and write is too small to matter. It is not.
alter table public.invoice_sends drop constraint if exists invoice_sends_kind_check;
alter table public.invoice_sends
  add constraint invoice_sends_kind_check
  check (kind in ('send', 'resend', 'scheduled'));

create unique index if not exists invoice_sends_scheduled_uniq
  on public.invoice_sends (invoice_id)
  where kind = 'scheduled';
