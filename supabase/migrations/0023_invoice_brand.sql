-- =============================================================================
-- Hartwell Pulse - 0023 invoice brand + deposits
-- Invoices can now be issued under either trading brand.
--
-- "Ironpeak Consulting" is a registered business name against Hartwell Digital's
-- ABN 44 286 503 049, so an Ironpeak invoice is legally the same entity and
-- carries the same ABN. The positioning rule is the point: on anything a client
-- or prospect sees, Ironpeak must NOT read as a sub-brand of a general digital
-- agency. No "a business of Hartwell Digital", no dual logos. The bare ABN line
-- is the only permitted expression of the parent.
--
-- Both brands share one invoice number sequence, which is Kyle's decision: one
-- business, one set of books, no chance of two invoices carrying the same
-- number.
--
-- Hartwell Digital is not registered for GST, so both brands head the document
-- "Invoice" rather than "Tax invoice" and never show a GST line.
--
-- Deposits: Kyle quotes a deposit and credits it against the invoice, so the
-- total stays the contract value and the deposit reduces what is left to pay.
-- Run after 0022. Idempotent.
-- =============================================================================

alter table public.invoices
  add column if not exists brand text not null default 'hartwell',
  add column if not exists deposit_amount numeric(12, 2) not null default 0,
  add column if not exists deposit_label text;

alter table public.invoices drop constraint if exists invoices_brand_check;
alter table public.invoices add constraint invoices_brand_check
  check (brand in ('hartwell', 'ironpeak'));

create index if not exists invoices_brand_idx on public.invoices (brand);

-- Kyle's chosen outreach pace: three a day, fifteen a week. Well above the
-- playbook's three a week, so the abort warning at 15 sends with no substantive
-- reply now lands after roughly one week rather than five. That is the brake
-- doing its job at this rate, not a fault.
update public.crm_settings
set daily_contact_goal = 3, weekly_contact_goal = 15
where id = true;
