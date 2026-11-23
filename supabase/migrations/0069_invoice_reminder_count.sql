-- 0069: how many overdue reminders an invoice has had (Kyle, 23 November 2026).
-- The overdue job sends a gentle nudge first, a firmer one two days later, then
-- the firm one weekly; it needs the count to know which is next. Invoices
-- already reminded once count as one, so the firmer one is next for them.
-- Safe to run twice.

alter table public.invoices add column if not exists reminder_count integer not null default 0;

update public.invoices
set reminder_count = 1
where reminder_sent_at is not null
  and reminder_count = 0;

notify pgrst, 'reload schema';

-- Check: one row per overdue invoice, with its count.
select invoice_number, due_date, reminder_sent_at, reminder_count
from public.invoices
where status = 'sent' and due_date < current_date
order by due_date;
