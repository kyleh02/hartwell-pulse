-- Correct an invoice that has already gone out, and send it again.
--
-- Until now a sent invoice was frozen. The only way to fix a wrong one was to
-- void it and raise a new number, which leaves a client holding two documents
-- for one job and a gap in the number sequence to explain. For an UNPAID
-- invoice, correcting it and reissuing under the same number is the ordinary
-- thing to do.
--
-- What must not happen is a silent change. If Daryl was emailed INV-0012 for
-- $170 and it quietly becomes $150, there is no way to answer "what did he
-- actually receive, and when". So every send is recorded: the amount, the due
-- date, the revision and the addresses it went to, at the moment it went.
-- Paid and void invoices stay locked, in the app and here.
--
-- Run after 0032. Idempotent.

-- Bumped each time an already-sent invoice is saved with changes. Revision 0
-- is the invoice as first issued.
alter table public.invoices
  add column if not exists revision integer not null default 0;

-- When it was last emailed. sent_at stays the FIRST send, so "issued on" does
-- not move under you every time a correction goes out.
alter table public.invoices
  add column if not exists last_sent_at timestamptz;

create table if not exists public.invoice_sends (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  revision integer not null default 0,
  -- Snapshotted, not joined. The point of this row is what the invoice said at
  -- the time, which is exactly what a later edit would destroy.
  total numeric(12, 2) not null default 0,
  due_date date,
  -- Email addresses as delivered, so the record survives someone later being
  -- removed from the account.
  sent_to text[] not null default '{}',
  kind text not null default 'send' check (kind in ('send', 'resend')),
  sent_at timestamptz not null default now(),
  sent_by text
);

create index if not exists invoice_sends_invoice_idx
  on public.invoice_sends (invoice_id, sent_at desc);

-- Admin only. This is Kyle's own record of what went out; a client reading it
-- would learn nothing useful and it is not theirs.
alter table public.invoice_sends enable row level security;
grant select, insert on public.invoice_sends to authenticated;

drop policy if exists invoice_sends_admin_all on public.invoice_sends;
create policy invoice_sends_admin_all on public.invoice_sends
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Backfill one row for every invoice already sent, so the history does not
-- start empty and look as though nothing was ever issued. Recipients are
-- unknown for these (they went to everyone on the account, which is what the
-- empty array means everywhere else), and the total is today's, which for an
-- invoice that has never been amended is also what was sent.
insert into public.invoice_sends (invoice_id, client_id, revision, total, due_date, sent_at, kind)
select i.id, i.client_id, 0, i.total, i.due_date, i.sent_at, 'send'
from public.invoices i
where i.sent_at is not null
  and not exists (select 1 from public.invoice_sends s where s.invoice_id = i.id);

update public.invoices
set last_sent_at = sent_at
where sent_at is not null and last_sent_at is null;
