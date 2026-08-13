-- Let a client watch their website being built, inside the portal.
--
-- A build in progress currently lives at a staging URL pasted into a chat
-- message, which means the client hunts for the most recent one and has no
-- idea whether it is still current. This gives it a place: named pages, in
-- order, with a note about what changed.
--
-- More than one row per client on purpose. A site is not one page, and "have a
-- look at the services page" is the normal request. It also lets an old
-- version be retired without losing the record of what was shown.
--
-- Run after 0040. Idempotent.

create table if not exists public.client_previews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  url text not null,
  -- What to look at, or what changed since last time. Optional.
  note text,
  position integer not null default 0,
  -- Hidden from the client without being deleted, for a page not ready to be
  -- seen. Kyle still sees it.
  visible boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_previews_client_idx
  on public.client_previews (client_id, position);

alter table public.client_previews enable row level security;
grant select, insert, update, delete on public.client_previews to authenticated;

-- The client sees their own, and only the ones marked visible. Kyle sees and
-- edits everything, same shape as every other client-scoped table here.
drop policy if exists client_previews_admin_all on public.client_previews;
create policy client_previews_admin_all on public.client_previews
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists client_previews_client_read on public.client_previews;
create policy client_previews_client_read on public.client_previews
  for select to authenticated
  using (client_id = public.current_client_id() and visible);
