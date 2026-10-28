-- 0057: Claude connector (Stage 6).
--
-- The portal is its own OAuth server for one purpose: letting Kyle connect
-- Claude to his pipeline. Claude registers itself (mcp_clients), Kyle approves
-- it on /oauth/authorize while signed in as admin (mcp_codes, single use, five
-- minutes), and Claude swaps the code for tokens (mcp_tokens).
--
-- Nothing here is ever read by a browser. Every table has RLS on and NO
-- policies, so only the service role, in the portal's own route handlers,
-- can touch them. Codes and tokens are stored as SHA-256 hashes, never as
-- the values themselves: a copy of this table is not a key to anything.
--
-- Safe to run more than once.

create table if not exists public.mcp_clients (
  client_id text primary key,
  client_name text,
  redirect_uris text[] not null,
  -- Only for a client that asked for a secret at registration.
  secret_hash text,
  token_endpoint_auth_method text not null default 'none',
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_codes (
  code_hash text primary key,
  client_id text not null,
  client_name text,
  user_id text not null,
  redirect_uri text not null,
  code_challenge text not null,
  scope text,
  resource text not null,
  family uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('access', 'refresh')),
  client_id text not null,
  client_name text,
  user_id text not null,
  scope text,
  resource text not null,
  -- Every token descended from one approval shares a family, so a stolen
  -- refresh token that is replayed can take the whole chain down with it.
  family uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcp_tokens_family_idx on public.mcp_tokens (family);
create index if not exists mcp_tokens_client_idx on public.mcp_tokens (client_id) where revoked_at is null;

alter table public.mcp_clients enable row level security;
alter table public.mcp_codes enable row level security;
alter table public.mcp_tokens enable row level security;
revoke all on public.mcp_clients, public.mcp_codes, public.mcp_tokens from anon, authenticated;

notify pgrst, 'reload schema';
