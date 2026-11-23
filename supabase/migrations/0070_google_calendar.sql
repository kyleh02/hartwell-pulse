-- 0070: the portal and admin@'s Google Calendar (Kyle, 23 November 2026).
-- The portal shows his Google Calendar and adds events to it, and puts its own
-- dated items there: sent invoices' due dates, open leads' follow-ups, and
-- dashboard work items with a due date.
--
-- google_calendar: the one connection, its refresh token sealed with
-- OUTREACH_TOKEN_KEY (as Draper's Gmail is). calendar_links: which Google
-- event each portal item became, so a change updates it and a paid invoice or
-- a done item removes it. Both are service role only: RLS on, no policies.
-- Safe to run twice.

create table if not exists public.google_calendar (
  id boolean primary key default true check (id),
  email text not null,
  calendar_id text not null default 'primary',
  refresh_token_enc text not null,
  scopes text[] not null default '{}',
  connected_by text,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_sync_error text
);
alter table public.google_calendar enable row level security;

create table if not exists public.calendar_links (
  source_kind text not null check (source_kind in ('invoice', 'lead', 'work_item')),
  source_id uuid not null,
  event_id text not null,
  fingerprint text not null,
  synced_at timestamptz not null default now(),
  primary key (source_kind, source_id)
);
alter table public.calendar_links enable row level security;

-- Explicit, because this project doesn't grant new tables to the API roles by
-- itself: without it the portal saw neither table (23 Nov 2026).
grant select, insert, update, delete on public.google_calendar, public.calendar_links to service_role;

notify pgrst, 'reload schema';

-- Check: both tables, RLS on.
select c.relname as "table", c.relrowsecurity as rls_on
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('google_calendar', 'calendar_links')
order by 1;
