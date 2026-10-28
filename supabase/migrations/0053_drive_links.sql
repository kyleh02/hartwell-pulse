-- =============================================================================
-- RETIRED 28 October 2026. Do not run.
--
-- Kyle decided to keep client files in the portal rather than in Google Drive
-- before this was ever connected, and the feature was removed. 0054 drops
-- these tables if they were created. Kept so the numbering has no gap.
-- =============================================================================

-- =============================================================================
-- 0053 — Google Drive folders, shown to clients inside the portal
--
-- Kyle keeps client work in Google Drive, and Claude saves into it. Rather than
-- copy files into the portal's own storage and keep two versions in step, the
-- portal reads a Drive folder linked to the client and shows it in their
-- Assets, in the portal's own design. Uploads from the client land in that
-- Drive folder. Nothing is shared in Google: the folders stay private to
-- Kyle's account and the portal is the only way a client reaches them.
--
-- Two tables. The connection holds Kyle's Google refresh token, encrypted by
-- the app before it arrives here, and is readable by the service role ONLY: it
-- opens the whole of his Drive. The links say which folder each client sees.
--
-- Run after 0052. Idempotent.
-- =============================================================================

-- ---------- the connection: one row, server only ----------
create table if not exists public.google_drive_connection (
  id smallint primary key default 1 check (id = 1),
  -- The account that approved access, shown in Settings.
  email text,
  -- AES-256-GCM, keyed from GOOGLE_CLIENT_SECRET. Never sent to a browser.
  refresh_token_enc text not null,
  scopes text,
  connected_by text,
  connected_at timestamptz not null default now()
);

-- RLS on with no policies, and no grants: the service role bypasses both, and
-- nobody signed in through the browser can read a single column of it.
alter table public.google_drive_connection enable row level security;
revoke all on public.google_drive_connection from anon, authenticated;

-- ---------- the links: which folders a client sees ----------
create table if not exists public.drive_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Google's id for the folder. Anything Kyle's account can open: his own
  -- Drive, a shared drive, or a folder someone else shared with him.
  folder_id text not null,
  -- The folder's name in Drive when it was linked, for Kyle. The client sees
  -- `title` instead, because "Client Shared (Portal)" is a label for him.
  drive_name text,
  title text not null,
  -- Whether the client may drop files in. Kyle's own Drive permissions still
  -- apply on top: a folder he can only view cannot take uploads either way.
  allow_uploads boolean not null default true,
  position integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, folder_id)
);

create index if not exists drive_links_client_idx
  on public.drive_links (client_id, position);

drop trigger if exists drive_links_set_updated_at on public.drive_links;
create trigger drive_links_set_updated_at
  before update on public.drive_links
  for each row execute function public.set_updated_at();

alter table public.drive_links enable row level security;
grant select, insert, update, delete on public.drive_links to authenticated;

drop policy if exists drive_links_admin_all on public.drive_links;
create policy drive_links_admin_all on public.drive_links
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- A client reads their own links and changes nothing. What is inside a folder
-- is decided by the server, which checks every request against these rows.
drop policy if exists drive_links_client_read on public.drive_links;
create policy drive_links_client_read on public.drive_links
  for select to authenticated
  using (client_id = public.current_client_id());
