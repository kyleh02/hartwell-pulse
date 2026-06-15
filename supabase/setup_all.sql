-- =============================================================================
-- Hartwell Pulse — full database setup (schema + RLS + storage)
-- Paste this whole file into the Supabase SQL Editor and Run, ONCE, on a fresh
-- project. It is the three migrations (0001 schema, 0002 RLS, 0003 storage) in
-- order. If you re-run it you will get "already exists" errors on the policies
-- and triggers — that is expected; it just means it already ran.
-- =============================================================================


-- #############################################################################
-- PART 1 — SCHEMA
-- #############################################################################

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Shared trigger to keep updated_at honest.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- clients
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  slug text not null unique,
  logo_url text,
  service_tier text not null default 'growth',
  status text not null default 'onboarding'
    check (status in ('onboarding', 'active', 'paused')),
  created_at timestamptz not null default now()
);

-- client_users — maps a Clerk user id to a client + role. The identity table.
create table if not exists public.client_users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  client_id uuid references public.clients(id) on delete cascade,
  role text not null check (role in ('admin', 'client')),
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  constraint client_role_requires_client check (
    role = 'admin' or (role = 'client' and client_id is not null)
  )
);
create index if not exists client_users_client_id_idx on public.client_users(client_id);

-- services — which services each client uses
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  service_key text not null
    check (service_key in ('google_ads', 'meta_ads', 'email', 'linkedin_ads', 'website')),
  display_name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, service_key)
);
create index if not exists services_client_id_idx on public.services(client_id);

-- api_connections — connected data sources. Sensitive: clients never read these.
create table if not exists public.api_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'error')),
  external_account_id text,
  credentials jsonb,
  connected_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_connections_client_id_idx on public.api_connections(client_id);

-- metrics — pulled metric data per client / service / month
create table if not exists public.metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  service_key text not null,
  metric_key text not null,
  label text not null,
  value numeric not null,
  unit text check (unit in ('count', 'aud', 'percent', 'ratio', 'seconds')),
  period_month date not null,
  created_at timestamptz not null default now(),
  unique (client_id, service_key, metric_key, period_month)
);
create index if not exists metrics_client_period_idx on public.metrics(client_id, period_month);

-- reports
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period_month date not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  template_key text,
  summary text,
  published_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, period_month),
  -- lets report_sections point a composite FK at (id, client_id) so a section
  -- can never belong to a different tenant than its parent report
  unique (id, client_id)
);
create index if not exists reports_client_id_idx on public.reports(client_id);
create trigger reports_set_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

-- report_sections — ordered sections within a report
create table if not exists public.report_sections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null
    check (kind in ('metrics', 'insights', 'recommendations', 'custom')),
  title text not null,
  body text,
  content jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  -- composite FK pins the section to its parent report AND that report's tenant
  foreign key (report_id, client_id)
    references public.reports(id, client_id) on delete cascade
);
create index if not exists report_sections_report_id_idx on public.report_sections(report_id);

-- insight_snippets — Kyle's reusable insight library (admin only)
create table if not exists public.insight_snippets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  category text,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- assets — client-uploaded (and admin) files
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  uploaded_by text not null,
  uploader_role text not null check (uploader_role in ('admin', 'client')),
  name text not null,
  storage_path text not null,
  file_url text,
  mime_type text,
  size_bytes bigint,
  kind text not null default 'other'
    check (kind in ('image', 'document', 'copy', 'other')),
  folder text,
  tags text[] not null default '{}',
  status text check (status in ('draft', 'approved', 'ready', 'urgent')),
  created_at timestamptz not null default now()
);
create index if not exists assets_client_id_idx on public.assets(client_id);

-- asset_comments — inline feedback on assets
create table if not exists public.asset_comments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  author_user_id text not null,
  author_role text not null check (author_role in ('admin', 'client')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists asset_comments_asset_id_idx on public.asset_comments(asset_id);

-- messages — one conversation per client (between that client and Kyle)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  sender_user_id text not null,
  sender_role text not null check (sender_role in ('admin', 'client')),
  body text not null default '',
  attachments jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_client_created_idx on public.messages(client_id, created_at);

-- message_reactions — emoji reactions
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists message_reactions_message_id_idx on public.message_reactions(message_id);

-- notifications — per-recipient, in-portal + email
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id text not null,
  client_id uuid references public.clients(id) on delete cascade,
  type text not null
    check (type in ('message', 'report_ready', 'asset_feedback', 'asset_uploaded', 'status_change')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_user_id, created_at);

-- board_cards — admin kanban / calendar (internal only, clients never see this)
create table if not exists public.board_cards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  description text,
  column_key text not null default 'pending'
    check (column_key in ('pending', 'in_progress', 'delivered')),
  card_type text not null default 'other',
  position integer not null default 0,
  due_date date,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists board_cards_column_idx on public.board_cards(column_key, position);
create trigger board_cards_set_updated_at
  before update on public.board_cards
  for each row execute function public.set_updated_at();


-- #############################################################################
-- PART 2 — ROW LEVEL SECURITY
-- #############################################################################

-- Identity helpers. is_admin() and current_client_id() are SECURITY DEFINER so
-- they read client_users without tripping its own RLS (no recursion).
create or replace function public.clerk_user_id()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'sub';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_users cu
    where cu.clerk_user_id = (auth.jwt() ->> 'sub')
      and cu.role = 'admin'
  );
$$;

create or replace function public.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cu.client_id
  from public.client_users cu
  where cu.clerk_user_id = (auth.jwt() ->> 'sub')
  limit 1;
$$;

-- Privileges. RLS still filters every row; these just let the role touch the
-- tables at all. anon (signed-out) gets nothing. service_role bypasses RLS.
grant usage on schema public to authenticated;
grant execute on function public.clerk_user_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_client_id() to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Enable RLS everywhere
alter table public.clients            enable row level security;
alter table public.client_users       enable row level security;
alter table public.services           enable row level security;
alter table public.api_connections    enable row level security;
alter table public.metrics            enable row level security;
alter table public.reports            enable row level security;
alter table public.report_sections    enable row level security;
alter table public.insight_snippets   enable row level security;
alter table public.assets             enable row level security;
alter table public.asset_comments     enable row level security;
alter table public.messages           enable row level security;
alter table public.message_reactions  enable row level security;
alter table public.notifications      enable row level security;
alter table public.board_cards        enable row level security;

-- clients — client reads only its own row; admin all
create policy clients_admin_all on public.clients
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy clients_client_read on public.clients
  for select to authenticated
  using (id = public.current_client_id());

-- client_users — a user reads only their own mapping row; admin all
create policy client_users_admin_all on public.client_users
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy client_users_self_read on public.client_users
  for select to authenticated
  using (clerk_user_id = public.clerk_user_id());

-- services — client reads own; admin all
create policy services_admin_all on public.services
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy services_client_read on public.services
  for select to authenticated
  using (client_id = public.current_client_id());

-- api_connections — ADMIN ONLY. Clients must never read credentials.
create policy api_connections_admin_all on public.api_connections
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- metrics — client reads own; admin all
create policy metrics_admin_all on public.metrics
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy metrics_client_read on public.metrics
  for select to authenticated
  using (client_id = public.current_client_id());

-- reports — client reads only its own PUBLISHED reports; admin all
create policy reports_admin_all on public.reports
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy reports_client_read on public.reports
  for select to authenticated
  using (client_id = public.current_client_id() and status = 'published');

-- report_sections — client reads own sections of published reports; admin all
create policy report_sections_admin_all on public.report_sections
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy report_sections_client_read on public.report_sections
  for select to authenticated
  using (
    client_id = public.current_client_id()
    and exists (
      select 1 from public.reports r
      where r.id = report_sections.report_id
        and r.client_id = report_sections.client_id
        and r.status = 'published'
    )
  );

-- insight_snippets — ADMIN ONLY (Kyle's private library)
create policy insight_snippets_admin_all on public.insight_snippets
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- assets — client reads all of its own; can create/edit/delete its OWN uploads
create policy assets_admin_all on public.assets
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy assets_client_read on public.assets
  for select to authenticated
  using (client_id = public.current_client_id());
create policy assets_client_insert on public.assets
  for insert to authenticated
  with check (
    client_id = public.current_client_id()
    and uploaded_by = public.clerk_user_id()
    and uploader_role = 'client'
  );
create policy assets_client_update on public.assets
  for update to authenticated
  using (
    client_id = public.current_client_id()
    and uploaded_by = public.clerk_user_id()
    and uploader_role = 'client'
  )
  with check (
    client_id = public.current_client_id()
    and uploaded_by = public.clerk_user_id()
    and uploader_role = 'client'
  );
create policy assets_client_delete on public.assets
  for delete to authenticated
  using (
    client_id = public.current_client_id()
    and uploaded_by = public.clerk_user_id()
    and uploader_role = 'client'
  );

-- asset_comments — client reads comments on its assets; can add its own
create policy asset_comments_admin_all on public.asset_comments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy asset_comments_client_read on public.asset_comments
  for select to authenticated
  using (client_id = public.current_client_id());
create policy asset_comments_client_insert on public.asset_comments
  for insert to authenticated
  with check (
    client_id = public.current_client_id()
    and author_user_id = public.clerk_user_id()
    and author_role = 'client'
    -- the asset being commented on must be the client's own, not just any asset
    and exists (
      select 1 from public.assets a
      where a.id = asset_id and a.client_id = public.current_client_id()
    )
  );

-- messages — client reads its conversation; can send as itself
create policy messages_admin_all on public.messages
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy messages_client_read on public.messages
  for select to authenticated
  using (client_id = public.current_client_id());
create policy messages_client_insert on public.messages
  for insert to authenticated
  with check (
    client_id = public.current_client_id()
    and sender_user_id = public.clerk_user_id()
    and sender_role = 'client'
  );
-- Messages are immutable to clients: no client UPDATE policy. This stops a
-- client editing or re-labelling (sender_role) a message after sending. Per
-- conversation read state will be its own table in the messaging phase.

-- message_reactions — client reads its conversation's reactions; manages its own
create policy message_reactions_admin_all on public.message_reactions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy message_reactions_client_read on public.message_reactions
  for select to authenticated
  using (client_id = public.current_client_id());
create policy message_reactions_client_insert on public.message_reactions
  for insert to authenticated
  with check (
    client_id = public.current_client_id()
    and user_id = public.clerk_user_id()
    -- the message being reacted to must be in the client's own conversation
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.client_id = public.current_client_id()
    )
  );
create policy message_reactions_client_delete on public.message_reactions
  for delete to authenticated
  using (
    client_id = public.current_client_id()
    and user_id = public.clerk_user_id()
  );

-- notifications — recipient reads + marks its own read; admin all
create policy notifications_admin_all on public.notifications
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy notifications_recipient_read on public.notifications
  for select to authenticated
  using (recipient_user_id = public.clerk_user_id());
create policy notifications_recipient_update on public.notifications
  for update to authenticated
  using (recipient_user_id = public.clerk_user_id())
  with check (recipient_user_id = public.clerk_user_id());

-- A recipient may mark a notification read, but not rewrite its content. This
-- trigger freezes every column except read_at for a signed-in non-admin.
-- Service role (no JWT sub) and admin are unaffected.
create or replace function public.notifications_client_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.clerk_user_id() is not null and not public.is_admin() then
    new.recipient_user_id := old.recipient_user_id;
    new.client_id := old.client_id;
    new.type := old.type;
    new.title := old.title;
    new.body := old.body;
    new.link := old.link;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger notifications_client_guard_update
  before update on public.notifications
  for each row execute function public.notifications_client_guard();

-- board_cards — ADMIN ONLY. The kanban is internal; clients never see it.
create policy board_cards_admin_all on public.board_cards
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- #############################################################################
-- PART 3 — STORAGE BUCKETS + POLICIES
-- Convention: objects live under <client_id>/... so RLS keys off the first
-- folder. Both buckets are private; the app hands out short-lived signed URLs.
-- #############################################################################

insert into storage.buckets (id, name, public)
values ('pulse-assets', 'pulse-assets', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('pulse-reports', 'pulse-reports', false)
on conflict (id) do nothing;

-- pulse-assets: clients read + write within their own prefix
create policy "pulse_assets_admin_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'pulse-assets' and public.is_admin())
  with check (bucket_id = 'pulse-assets' and public.is_admin());

create policy "pulse_assets_client_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );

create policy "pulse_assets_client_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );

create policy "pulse_assets_client_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  )
  with check (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );

create policy "pulse_assets_client_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );

-- pulse-reports: admin writes, clients read their own
create policy "pulse_reports_admin_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'pulse-reports' and public.is_admin())
  with check (bucket_id = 'pulse-reports' and public.is_admin());

create policy "pulse_reports_client_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pulse-reports'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );

-- Done. Next: Authentication -> Third-Party Auth -> add Clerk
-- (https://ready-burro-86.clerk.accounts.dev), then map your admin user in
-- public.client_users.
