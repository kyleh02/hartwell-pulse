-- Sending a report becomes an explicit act, with a choice of who gets it.
--
-- Until now, publishing fired a trigger that dropped a line into every person
-- on the account's WEEKLY DIGEST. So a report Kyle had just finished might not
-- reach anyone for six days, everyone on the account got it whether or not it
-- was meant for them, and there was no way to tell whether it had landed.
--
-- Same recipient rule as invoices: an EMPTY array means everyone on the
-- account. That keeps a one-contact client working with no configuration, and
-- it is what every existing report carries.

alter table public.reports
  add column if not exists recipient_user_ids text[] not null default '{}';

alter table public.reports
  add column if not exists sent_at timestamptz;

alter table public.reports
  add column if not exists email_message text;

comment on column public.reports.recipient_user_ids is
  'Clerk user ids to send this report to. Empty means everyone on the client account.';

-- The trigger goes. Sending now happens in the app, where it can respect the
-- chosen recipients, carry a real email with a link, and record that it went.
-- Leaving the trigger in place would notify a second time for the same event,
-- which is worse than not notifying at all.
drop trigger if exists reports_notify on public.reports;
drop function if exists public.notify_on_report_publish();
