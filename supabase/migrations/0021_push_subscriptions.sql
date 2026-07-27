-- =============================================================================
-- Hartwell Pulse — 0021 web push subscriptions
-- One row per device that has opted in to push notifications. Written and read
-- ONLY by trusted server code (server actions using the service role), so
-- RLS is enabled with no policies at all: a signed-in browser can never read
-- another device's push keys, which are effectively send-credentials.
-- Sending happens from a server action right after a message is inserted, so
-- pushes work whether or not the recipient has the portal open. Run after
-- 0020. Idempotent.
-- =============================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  -- The endpoint is the device's unique push address; upserting on it stops a
  -- browser that re-subscribes from piling up duplicate rows.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (clerk_user_id);

alter table public.push_subscriptions enable row level security;

-- Deliberately no grants to anon/authenticated: every read and write goes
-- through the service role in server actions.
revoke all on public.push_subscriptions from anon, authenticated;
