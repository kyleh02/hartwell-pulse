-- Choose who on an account an invoice goes to.
--
-- Until now every invoice email and every reminder went to every person on the
-- client account. On a one-person account that is right. On SecureSupply it
-- meant a partner received an invoice addressed to the owner, could not open
-- it, and had to ask what it was for.
--
-- An EMPTY array means everyone on the account. That is deliberate: it is what
-- every invoice written before this column existed carries, so nothing already
-- in the system changes behaviour, and it stays the right answer for a client
-- with a single contact who should never have to configure anything.
--
-- Clerk user ids, not client_users ids, because that is what notifications and
-- the email lookup both key on.

alter table public.invoices
  add column if not exists recipient_user_ids text[] not null default '{}';

comment on column public.invoices.recipient_user_ids is
  'Clerk user ids to send this invoice and its reminders to. Empty means everyone on the client account.';
