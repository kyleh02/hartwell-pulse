-- =============================================================================
-- Hartwell Pulse — 0001 schema
-- Run this first (Supabase Dashboard -> SQL Editor, or `supabase db push`).
-- Row Level Security policies live in 0002_rls.sql and storage in 0003_storage.sql.
-- =============================================================================

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

-- -----------------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- client_users — maps a Clerk user id to a client + role. The identity table.
-- admins have no client_id; clients must have one.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- services — which services each client uses
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- api_connections — connected data sources. Sensitive: clients never read these.
-- credentials should be encrypted (Supabase Vault / pgsodium) in production.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- metrics — pulled metric data per client / service / month
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- reports
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- report_sections — ordered sections within a report
-- client_id is denormalised so RLS stays simple and fast.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- insight_snippets — Kyle's reusable insight library (admin only)
-- -----------------------------------------------------------------------------
create table if not exists public.insight_snippets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null,
  category text,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- assets — client-uploaded (and admin) files
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- asset_comments — inline feedback on assets
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- messages — one conversation per client (between that client and Kyle)
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- message_reactions — emoji reactions
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- notifications — per-recipient, in-portal + email
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- board_cards — admin kanban / calendar (internal only, clients never see this)
-- -----------------------------------------------------------------------------
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
