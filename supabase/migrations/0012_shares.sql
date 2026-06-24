-- =============================================================================
-- Hartwell Pulse — 0012 private share links (tokenised, revocable)
-- Stores ONLY a hash of the token; the raw token lives only in the URL the owner
-- copies. Resolution happens server-side via the service role in /share/[token],
-- which mints a short-lived signed URL on each authorised hit — a raw Supabase
-- signed URL is never handed out (those can't be revoked and are CDN-cached past
-- expiry). These policies only govern owners managing their own shares. Run after 0011.
-- =============================================================================

create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  folder_id uuid references public.asset_folders(id) on delete cascade,
  created_by text not null,
  token_hash text not null unique,         -- sha256(token), never the raw token
  access text not null default 'view' check (access in ('view')),
  require_login boolean not null default true,
  expires_at timestamptz,
  max_uses int,
  use_count int not null default 0,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shares_one_target check (num_nonnulls(asset_id, folder_id) = 1)
);
create index if not exists shares_client_idx on public.shares(client_id);
create index if not exists shares_token_idx on public.shares(token_hash);

grant select, insert, update, delete on public.shares to authenticated;
alter table public.shares enable row level security;

create policy shares_admin_all on public.shares
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy shares_client_read on public.shares
  for select to authenticated using (client_id = public.current_client_id());
create policy shares_client_insert on public.shares
  for insert to authenticated
  with check (client_id = public.current_client_id() and created_by = public.clerk_user_id());
create policy shares_client_update on public.shares
  for update to authenticated
  using (client_id = public.current_client_id())
  with check (client_id = public.current_client_id());
create policy shares_client_delete on public.shares
  for delete to authenticated using (client_id = public.current_client_id());
