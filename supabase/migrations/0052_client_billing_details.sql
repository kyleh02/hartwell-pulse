-- =============================================================================
-- Hartwell Pulse — 0052 client billing details on invoices
--
-- A client's legal entity name, ABN, billing address and an attention-to name,
-- kept on the client's profile and printed in the Bill to block of their
-- invoices.
--
-- An invoice keeps the details it was ISSUED with. A draft shows the profile as
-- it currently stands; sending freezes it onto the invoice as bill_to, and
-- correcting and resending refreshes it. Without that, changing a client's
-- address next year would rewrite the Bill to on every invoice they have ever
-- been sent, and the portal would stop matching the PDFs in their inbox. That
-- is the "snapshotted, not joined" rule the send history already follows.
--
-- Run after 0051. Re-runnable.
-- =============================================================================

alter table public.clients
  -- The registered entity, when it differs from the name the business trades
  -- under: "Deesha Global Pty Ltd" trading as something shorter.
  add column if not exists legal_name text,
  -- Eleven digits, no spaces. Formatted for display, never stored formatted, so
  -- there is one way to write it and comparing two is a string comparison.
  add column if not exists abn text,
  add column if not exists billing_address text,
  -- Who the invoice is for the attention of, often an accounts person.
  add column if not exists billing_attention text;

-- The app checks the ATO checksum before saving. This catches anything that
-- arrives some other way, such as a hand edit in the SQL editor.
alter table public.clients drop constraint if exists clients_abn_format_check;
alter table public.clients
  add constraint clients_abn_format_check
  check (abn is null or abn ~ '^[0-9]{11}$');

alter table public.invoices
  -- The Bill to block exactly as it was issued. Null on a draft, which shows the
  -- client's profile live.
  add column if not exists bill_to jsonb,
  -- Whether the attached PDF was made by the portal or uploaded by hand. A send
  -- regenerates a generated one so it can never go out showing superseded
  -- figures; a hand upload is a deliberate override and is left alone.
  add column if not exists pdf_source text;

alter table public.invoices drop constraint if exists invoices_pdf_source_check;
alter table public.invoices
  add constraint invoices_pdf_source_check
  check (pdf_source is null or pdf_source in ('generated', 'uploaded'));

-- Every invoice that has already gone out named the client by business name and
-- nothing else, because nothing else existed. Freeze exactly that, so filling in
-- a client's billing details today does not change what an invoice already in
-- their inbox appears to have said. Only fills blanks, so running this twice
-- changes nothing.
update public.invoices i
set bill_to = jsonb_build_object('name', c.business_name)
from public.clients c
where c.id = i.client_id
  and i.status <> 'draft'
  and i.bill_to is null;
