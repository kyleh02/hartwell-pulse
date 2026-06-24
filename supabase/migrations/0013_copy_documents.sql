-- =============================================================================
-- Hartwell Pulse — 0013 copy documents (Google-Docs-style drafting)
-- Tiptap/ProseMirror JSON stored in Postgres with periodic version snapshots.
-- Async review: a client drafts then Submits; admin reads, then Approves or
-- Requests changes. RLS mirrors the existing client_id tenancy. Run after 0012.
-- =============================================================================

create table if not exists public.copy_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  folder_id uuid references public.asset_folders(id) on delete set null,
  title text not null default 'Untitled',
  body_json jsonb not null default '{}'::jsonb,   -- canonical ProseMirror doc
  body_html text,                                  -- optional cached render
  review_note text,                                -- admin feedback when changes requested
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','changes_requested')),
  created_by text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists copy_documents_client_idx on public.copy_documents(client_id);

create table if not exists public.copy_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.copy_documents(id) on delete cascade,
  body_json jsonb not null,
  label text,                                      -- 'autosave' | 'submitted' | manual
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists copy_doc_versions_doc_idx
  on public.copy_document_versions(document_id, created_at desc);

grant select, insert, update, delete on public.copy_documents to authenticated;
grant select, insert, update, delete on public.copy_document_versions to authenticated;
alter table public.copy_documents enable row level security;
alter table public.copy_document_versions enable row level security;

create policy copy_docs_admin_all on public.copy_documents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy copy_docs_client_read on public.copy_documents
  for select to authenticated using (client_id = public.current_client_id());
create policy copy_docs_client_write on public.copy_documents
  for all to authenticated
  using (client_id = public.current_client_id())
  with check (client_id = public.current_client_id());

create policy copy_ver_admin_all on public.copy_document_versions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy copy_ver_client_read on public.copy_document_versions
  for select to authenticated
  using (exists (select 1 from public.copy_documents d
                 where d.id = document_id and d.client_id = public.current_client_id()));
create policy copy_ver_client_insert on public.copy_document_versions
  for insert to authenticated
  with check (exists (select 1 from public.copy_documents d
                      where d.id = document_id and d.client_id = public.current_client_id()));

-- A client may draft and submit their own copy, but only an admin may approve or
-- request changes. RLS lets a client update their own row, so without this guard
-- a client could PATCH status straight to 'approved' (the UI gate is client-side
-- only). Content edits (status unchanged) are unaffected. Service role + admin pass.
create or replace function public.copy_documents_client_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.clerk_user_id() is null or public.is_admin() then
    return new;
  end if;
  if new.status is distinct from old.status
     and new.status not in ('draft', 'submitted') then
    raise exception 'only an admin can approve or request changes';
  end if;
  if new.review_note is distinct from old.review_note then
    raise exception 'only an admin can set the review note';
  end if;
  return new;
end $$;
drop trigger if exists copy_documents_client_guard_trg on public.copy_documents;
create trigger copy_documents_client_guard_trg
  before update on public.copy_documents
  for each row execute function public.copy_documents_client_guard();
