-- =============================================================================
-- 0054 — the content approval board
--
-- Kyle posts work for a client to sign off: website copy, designs, social
-- posts and ads. The client approves it or asks for changes with a comment,
-- Kyle updates it and sends the next version, and every step is kept. It
-- replaces approvals by email and by Google Drive comment, so everything about
-- a piece of work sits in one place in the portal.
--
-- Also:
-- - drops the two Google Drive tables from 0053, retired on 28 October 2026
--   before it was ever connected (they are empty, if they exist at all);
-- - widens the notification types for this and the next stages (onboarding,
--   NPS and the assistant), so the constraint is only rewritten once.
--
-- Run after 0052 (0053 need not have been run). Idempotent.
-- =============================================================================

drop table if exists public.drive_links;
drop table if exists public.google_drive_connection;

-- ---------- the pieces of work ----------
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('copy', 'design', 'social', 'ad')),
  title text not null,
  -- The words themselves: page copy, a post's caption, an ad's text.
  body text,
  -- What Kyle wants them to look at, in a sentence or two.
  note text,
  -- Where it is going: Instagram, Google Ads, the home page.
  channel text,
  -- draft: Kyle's, unseen. waiting: on the client. changes: back with Kyle.
  -- approved: signed off.
  status text not null default 'draft'
    check (status in ('draft', 'waiting', 'changes', 'approved')),
  -- Which version the client is looking at. Goes up each time Kyle sends it
  -- again after they asked for changes.
  round integer not null default 1,
  due_on date,
  sent_at timestamptz,
  decided_at timestamptz,
  decided_by text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists approvals_client_idx on public.approvals (client_id, status);

drop trigger if exists approvals_set_updated_at on public.approvals;
create trigger approvals_set_updated_at
  before update on public.approvals
  for each row execute function public.set_updated_at();

-- ---------- the files on each (images, PDFs, video) ----------
-- In the pulse-reports bucket under <client_id>/approvals/<approval_id>/, so
-- the existing storage policies already let the client read their own and
-- only Kyle write.
create table if not exists public.approval_files (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approvals(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists approval_files_approval_idx on public.approval_files (approval_id, position);

-- ---------- what happened, in order ----------
create table if not exists public.approval_events (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approvals(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('sent', 'approved', 'changes', 'comment')),
  body text,
  round integer not null default 1,
  author_id text,
  author_role text check (author_role in ('admin', 'client')),
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists approval_events_approval_idx on public.approval_events (approval_id, created_at);

-- ---------- RLS ----------
-- Kyle does everything. A client READS their own work once it has been sent,
-- and nothing more: approving, asking for changes and commenting go through
-- server actions that check the client and the state first, so a client can
-- never edit what they are approving or approve something not yet sent.
do $$
declare t text;
begin
  foreach t in array array['approvals', 'approval_files', 'approval_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

drop policy if exists approvals_client_read on public.approvals;
create policy approvals_client_read on public.approvals
  for select to authenticated
  using (client_id = public.current_client_id() and status <> 'draft');

drop policy if exists approval_files_client_read on public.approval_files;
create policy approval_files_client_read on public.approval_files
  for select to authenticated
  using (
    client_id = public.current_client_id()
    and exists (
      select 1 from public.approvals a
      where a.id = approval_id and a.status <> 'draft'
    )
  );

drop policy if exists approval_events_client_read on public.approval_events;
create policy approval_events_client_read on public.approval_events
  for select to authenticated
  using (
    client_id = public.current_client_id()
    and exists (
      select 1 from public.approvals a
      where a.id = approval_id and a.status <> 'draft'
    )
  );

-- ---------- notification types for this stage and the next ones ----------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'message', 'report_ready', 'asset_feedback', 'asset_uploaded',
    'status_change', 'invoice', 'crm_reminder', 'work_brief',
    'approval', 'onboarding', 'nps', 'assistant'
  ));

notify pgrst, 'reload schema';
