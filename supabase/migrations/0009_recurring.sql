-- =============================================================================
-- Hartwell Pulse — 0009 true auto-send recurring invoices (retainers / hosting)
-- A recurring "template" is an invoice with recurring_active = true that is never
-- sent itself; a daily cron materialises it into a real, sent invoice each month.
-- Run after 0008.
-- =============================================================================

alter table public.invoices
  add column if not exists recurring_active boolean,            -- true on a TEMPLATE; null on normal invoices
  add column if not exists recurring_anchor_day smallint        -- day-of-month to bill (1..28; capped so Feb never skips)
    check (recurring_anchor_day is null or recurring_anchor_day between 1 and 28),
  add column if not exists recurring_source_id uuid             -- on a GENERATED invoice -> the template it came from
    references public.invoices(id) on delete set null,
  add column if not exists recurring_period date;               -- the month this generated invoice covers (1st of month)

-- THE anti-double-billing guarantee: one generated invoice per template per
-- month. A retried/duplicate cron run hits this and is silently skipped.
create unique index if not exists invoices_recurring_period_uniq
  on public.invoices (recurring_source_id, recurring_period)
  where recurring_source_id is not null;

-- Fast "which templates are active?" scan for the cron.
create index if not exists invoices_recurring_active_idx
  on public.invoices (recurring_active) where recurring_active is true;

-- Atomic invoice numbering. count(*)+1 races once a machine issues numbers, and
-- breaks if drafts are deleted. A sequence allocates unique numbers (gaps are
-- fine for invoice numbers; collisions are not).
create sequence if not exists public.invoice_number_seq;
do $$
declare maxn integer;
begin
  select coalesce(max((regexp_replace(invoice_number, '\D', '', 'g'))::integer), 0)
    into maxn
    from public.invoices
    where invoice_number ~ '\d';
  perform setval('public.invoice_number_seq', greatest(maxn, 1), maxn > 0);
end $$;

create or replace function public.next_invoice_number()
returns text language sql security definer set search_path = public as $$
  select 'INV-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
$$;
grant execute on function public.next_invoice_number() to authenticated, service_role;
