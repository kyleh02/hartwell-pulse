-- =============================================================================
-- Hartwell Pulse — 0051 extra documents sent with an invoice
--
-- An invoice can carry other documents alongside its own PDF, a scope of works
-- or a quote for example, and they go out in the same email.
--
-- A table rather than a column, because there can be several, each with its own
-- name and size, and the same shape as invoice_line_items so it inherits the
-- same rules: the composite foreign key makes it impossible for a document to
-- point at an invoice belonging to a different client, and the cascade removes
-- the rows when a draft invoice is deleted.
--
-- The files live in the existing private pulse-reports bucket under
-- <client_id>/<invoice_id>/attachments/, so the storage policies that already
-- exist cover them: the admin writes, and a client can only ever read inside
-- their own client_id folder.
--
-- Additive. An invoice with no documents attached behaves exactly as before.
-- Run after 0050.
-- =============================================================================

create table if not exists public.invoice_attachments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- One row per stored object. Unique so a retried save cannot record the same
  -- file twice and send it twice.
  storage_path text not null unique,
  -- The name the client sees on the attachment, as it was uploaded.
  file_name text not null,
  mime_type text,
  -- The size as storage reports it, not as the browser claimed it. Capped here
  -- as well as in the app: Resend refuses an email over 40 MB after base64
  -- encoding, and a cap that only lives in a button is not a cap.
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by text,
  foreign key (invoice_id, client_id)
    references public.invoices(id, client_id) on delete cascade
);

create index if not exists invoice_attachments_invoice_idx
  on public.invoice_attachments (invoice_id, position);

grant select, insert, update, delete on public.invoice_attachments
  to authenticated, service_role;

alter table public.invoice_attachments enable row level security;

-- Dropped first because Postgres has no CREATE POLICY IF NOT EXISTS and this
-- file has to stay re-runnable.
drop policy if exists invoice_attachments_admin_all on public.invoice_attachments;
create policy invoice_attachments_admin_all on public.invoice_attachments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Same rule as the line items: a client sees the documents on their own
-- invoices, and never on a draft, which they cannot see either.
drop policy if exists invoice_attachments_client_read on public.invoice_attachments;
create policy invoice_attachments_client_read on public.invoice_attachments
  for select to authenticated
  using (
    client_id = public.current_client_id()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_attachments.invoice_id
        and i.client_id = invoice_attachments.client_id
        and i.status <> 'draft'
    )
  );

-- What went out with each send, by name. The send record exists to answer
-- "what did they actually receive", and that now includes which documents.
alter table public.invoice_sends
  add column if not exists attachment_names text[] not null default '{}';
