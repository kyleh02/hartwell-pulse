-- =============================================================================
-- Hartwell Pulse — 0017 conversations (admin-managed, soft-delete + restore)
-- A conversations row per client thread, so the admin Messages page lists only
-- real conversations (started deliberately or by an incoming message) instead of
-- auto-listing every client. Deleting is a SOFT delete: messages are hidden from
-- BOTH sides via a restrictive RLS policy and restorable for 30 days, after
-- which the daily purge cron removes the thread for good. A new message from
-- either side (or the admin starting one) creates/revives the conversation via a
-- SECURITY DEFINER trigger. Run after 0016.
-- =============================================================================

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);
create index if not exists conversations_client_idx on public.conversations(client_id);

grant select, insert, update, delete on public.conversations to authenticated;
alter table public.conversations enable row level security;

drop policy if exists conversations_admin_all on public.conversations;
create policy conversations_admin_all on public.conversations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists conversations_client_read on public.conversations;
create policy conversations_client_read on public.conversations
  for select to authenticated using (client_id = public.current_client_id());

-- Is this client's conversation currently visible? (no row / soft-deleted = no)
create or replace function public.conversation_active(p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select deleted_at is null from public.conversations where client_id = p_client_id),
    false);
$$;
grant execute on function public.conversation_active(uuid) to authenticated;

-- Hide messages of deleted (or non-existent) conversations from BOTH sides.
-- Restore clears deleted_at and the whole history reappears. The service role
-- (crons, purge) bypasses RLS as usual.
drop policy if exists messages_restrict_select on public.messages;
create policy messages_restrict_select on public.messages
  as restrictive for select to authenticated
  using (public.conversation_active(client_id));

-- Any new message creates the conversation if missing, or revives a soft-deleted
-- one — so a client writing in always reaches the admin, and history returns.
create or replace function public.messages_ensure_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.conversations (client_id, created_by)
  values (new.client_id, new.sender_user_id)
  on conflict (client_id) do update
    set deleted_at = null, deleted_by = null
    where conversations.deleted_at is not null;
  return new;
end $$;
drop trigger if exists messages_ensure_conversation_trg on public.messages;
create trigger messages_ensure_conversation_trg
  before insert on public.messages
  for each row execute function public.messages_ensure_conversation();

-- Backfill: every client that already has messages gets an active conversation.
insert into public.conversations (client_id)
select distinct m.client_id from public.messages m
on conflict (client_id) do nothing;
