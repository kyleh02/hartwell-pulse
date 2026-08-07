-- Reports carry a trading brand, the same way invoices do.
--
-- Same legal entity and ABN either way. The column only decides which
-- letterhead, typography and colours the document is dressed in, so an
-- Ironpeak engagement gets an Ironpeak report rather than a Hartwell one with
-- the wrong logo on it.
--
-- Defaults to 'hartwell' so every existing report keeps exactly the look it
-- already had.

alter table public.reports
  add column if not exists brand text not null default 'hartwell';

alter table public.reports
  drop constraint if exists reports_brand_check;

alter table public.reports
  add constraint reports_brand_check check (brand in ('hartwell', 'ironpeak'));
