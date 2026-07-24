-- =============================================================================
-- Hartwell Pulse — 0018 multi-user messaging (members + read receipts)
-- A client may now have several portal users (e.g. SecureSupply: Daryl +
-- Deepayan) and several conversations:
--   * 'direct' — one client user + Kyle. Private: invisible to teammates.
--   * 'group'  — a chosen set of the client's users + Kyle.
-- conversation_members is both the visibility boundary (RLS: clients only see
-- threads they are members of) and the read receipt (last_read_at). Messages
-- gain conversation_id. Everything else client-scoped (assets, invoices,
-- reports) is untouched and stays shared across the client's users.
--
-- Paste this BEFORE deploying the matching app code: a legacy trigger path
-- routes conversation_id-less inserts from the old app into the right direct
-- thread, so the portal keeps working during the cutover.
-- Behaviour change vs 0017: a client can no longer revive a soft-deleted
-- thread by writing into it (their page simply has no thread) — restore it
-- from Messages instead. Run after 0017. Idempotent.
-- =============================================================================

-- ---------- conversations: kind / direct user / title ----------
alter table public.conversations
  add column if not exists kind text not null default 'direct',
  add column if not exists direct_user_id text,
  add column if not exists title text;

alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check
  check (kind in ('direct', 'group'));

-- Point the existing one-per-client conversations at that client's user.
update public.conversations c
set direct_user_id = (
  select cu.clerk_user_id
  from public.client_users cu
  where cu.client_id = c.client_id and cu.role = 'client'
  order by cu.created_at asc
  limit 1
)
where c.kind = 'direct' and c.direct_user_id is null;

-- A client may now hold many conversations; a user holds at most one direct.
alter table public.conversations drop constraint if exists conversations_client_id_key;
create unique index if not exists conversations_direct_unique
  on public.conversations (client_id, direct_user_id)
  where kind = 'direct';

-- Every existing client user gets their direct thread (the trigger below only
-- covers users created from now on).
insert into public.conversations (client_id, kind, direct_user_id, created_by)
select cu.client_id, 'direct', cu.clerk_user_id, cu.clerk_user_id
from public.client_users cu
where cu.role = 'client' and cu.client_id is not null
on conflict (client_id, direct_user_id) where kind = 'direct' do nothing;

-- ---------- conversation_members: visibility + read receipts ----------
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  clerk_user_id text not null,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, clerk_user_id)
);
create index if not exists conversation_members_user_idx
  on public.conversation_members (clerk_user_id);

grant select, insert on public.conversation_members to authenticated;
-- Members may only ever change their own read marker, nothing else.
revoke update on public.conversation_members from authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;

-- Membership check that dodges RLS recursion (policies on conversation_members,
-- conversations and messages all lean on it).
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.clerk_user_id = (auth.jwt() ->> 'sub')
  );
$$;
grant execute on function public.is_conversation_member(uuid) to authenticated;

-- Which client owns a conversation (used by the messages insert policy without
-- tripping conversations RLS).
create or replace function public.conversation_client_id(p_conversation_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from public.conversations where id = p_conversation_id;
$$;
grant execute on function public.conversation_client_id(uuid) to authenticated;

alter table public.conversation_members enable row level security;

drop policy if exists conversation_members_admin_all on public.conversation_members;
create policy conversation_members_admin_all on public.conversation_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Members of a thread see each other's rows — that IS the read receipt.
drop policy if exists conversation_members_peer_read on public.conversation_members;
create policy conversation_members_peer_read on public.conversation_members
  for select to authenticated
  using (public.is_conversation_member(conversation_id));

-- A member may update their own row (the column grant limits it to last_read_at).
drop policy if exists conversation_members_self_update on public.conversation_members;
create policy conversation_members_self_update on public.conversation_members
  for update to authenticated
  using (clerk_user_id = public.clerk_user_id())
  with check (clerk_user_id = public.clerk_user_id());

-- ---------- conversations RLS: clients need membership, not just tenancy ----------
drop policy if exists conversations_client_read on public.conversations;
create policy conversations_client_read on public.conversations
  for select to authenticated
  using (
    client_id = public.current_client_id()
    and public.is_conversation_member(id)
  );

-- ---------- messages: conversation_id ----------
alter table public.messages
  add column if not exists conversation_id uuid
    references public.conversations(id) on delete cascade;

-- Attach every existing message to its client's direct conversation. At
-- migration time each client has exactly one direct thread, so this is
-- unambiguous; re-runs find no NULL rows and do nothing.
update public.messages m
set conversation_id = c.id
from public.conversations c
where m.conversation_id is null
  and c.client_id = m.client_id
  and c.kind = 'direct';

do $$ begin
  if not exists (select 1 from public.messages where conversation_id is null) then
    alter table public.messages alter column conversation_id set not null;
  end if;
end $$;

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

-- ---------- messages RLS: membership-scoped ----------
drop policy if exists messages_client_read on public.messages;
create policy messages_client_read on public.messages
  for select to authenticated
  using (
    client_id = public.current_client_id()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists messages_client_insert on public.messages;
create policy messages_client_insert on public.messages
  for insert to authenticated
  with check (
    client_id = public.current_client_id()
    and sender_user_id = public.clerk_user_id()
    and sender_role = 'client'
    and public.is_conversation_member(conversation_id)
    and public.conversation_client_id(conversation_id) = public.current_client_id()
  );

-- Soft-deleted threads stay hidden from BOTH sides — now keyed on the
-- conversation itself instead of the client (0017's conversation_active).
create or replace function public.conversation_live(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select deleted_at is null from public.conversations where id = p_conversation_id),
    false);
$$;
grant execute on function public.conversation_live(uuid) to authenticated;

drop policy if exists messages_restrict_select on public.messages;
create policy messages_restrict_select on public.messages
  as restrictive for select to authenticated
  using (public.conversation_live(conversation_id));

drop function if exists public.conversation_active(uuid);

-- Reactions ride on message visibility: the subquery runs under the caller's
-- RLS, so reactions on a teammate's private thread are invisible too.
drop policy if exists message_reactions_client_read on public.message_reactions;
create policy message_reactions_client_read on public.message_reactions
  for select to authenticated
  using (
    client_id = public.current_client_id()
    and exists (select 1 from public.messages m where m.id = message_id)
  );

-- ---------- message routing trigger (replaces 0017's ensure-conversation) ----------
-- With an explicit conversation_id: validate it, keep client_id honest, revive
-- a soft-deleted thread. Without one (pre-0018 app code during cutover): route
-- to the sender's direct thread, creating it if need be. Membership is only
-- granted on threads this trigger CREATES — never on explicit ids, or a
-- teammate could write themselves into a private thread.
create or replace function public.messages_ensure_conversation()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
  created boolean := false;
begin
  if new.conversation_id is null then
    if new.sender_role = 'client' then
      select * into conv from public.conversations
      where client_id = new.client_id and kind = 'direct'
        and direct_user_id = new.sender_user_id;
    end if;
    if conv.id is null then
      select * into conv from public.conversations
      where client_id = new.client_id and kind = 'direct'
      order by created_at asc
      limit 1;
    end if;
    if conv.id is null then
      insert into public.conversations (client_id, kind, direct_user_id, created_by)
      values (
        new.client_id,
        'direct',
        case when new.sender_role = 'client' then new.sender_user_id end,
        new.sender_user_id
      )
      returning * into conv;
      created := true;
    end if;
    new.conversation_id := conv.id;
  else
    select * into conv from public.conversations where id = new.conversation_id;
    if conv.id is null then
      raise exception 'Conversation % does not exist', new.conversation_id;
    end if;
  end if;

  -- Keep the denormalised client_id honest, whoever is writing.
  new.client_id := conv.client_id;

  if created then
    insert into public.conversation_members (conversation_id, clerk_user_id)
    values (conv.id, new.sender_user_id)
    on conflict (conversation_id, clerk_user_id) do nothing;
    insert into public.conversation_members (conversation_id, clerk_user_id)
    select conv.id, cu.clerk_user_id
    from public.client_users cu
    where cu.role = 'admin'
    on conflict (conversation_id, clerk_user_id) do nothing;
  end if;

  -- A new message revives a soft-deleted thread (history returns for everyone).
  if conv.deleted_at is not null then
    update public.conversations
    set deleted_at = null, deleted_by = null
    where id = conv.id;
  end if;
  return new;
end $$;
drop trigger if exists messages_ensure_conversation_trg on public.messages;
create trigger messages_ensure_conversation_trg
  before insert on public.messages
  for each row execute function public.messages_ensure_conversation();

-- ---------- new client user => their direct thread, ready to go ----------
create or replace function public.client_user_direct_conversation()
returns trigger
language plpgsql security definer set search_path = public as $$
declare conv_id uuid;
begin
  if new.role <> 'client' or new.client_id is null then
    return new;
  end if;
  insert into public.conversations (client_id, kind, direct_user_id, created_by)
  values (new.client_id, 'direct', new.clerk_user_id, new.clerk_user_id)
  on conflict (client_id, direct_user_id) where kind = 'direct' do nothing;
  select id into conv_id from public.conversations
  where client_id = new.client_id and kind = 'direct'
    and direct_user_id = new.clerk_user_id;
  insert into public.conversation_members (conversation_id, clerk_user_id)
  values (conv_id, new.clerk_user_id)
  on conflict (conversation_id, clerk_user_id) do nothing;
  insert into public.conversation_members (conversation_id, clerk_user_id)
  select conv_id, cu.clerk_user_id
  from public.client_users cu
  where cu.role = 'admin'
  on conflict (conversation_id, clerk_user_id) do nothing;
  return new;
end $$;
drop trigger if exists client_users_direct_conversation_trg on public.client_users;
create trigger client_users_direct_conversation_trg
  after insert on public.client_users
  for each row execute function public.client_user_direct_conversation();

-- ---------- membership backfill for existing threads ----------
-- Marked read as of now, so nobody's badge floods at cutover.
insert into public.conversation_members (conversation_id, clerk_user_id, last_read_at)
select c.id, c.direct_user_id, now()
from public.conversations c
where c.kind = 'direct' and c.direct_user_id is not null
on conflict (conversation_id, clerk_user_id) do nothing;

insert into public.conversation_members (conversation_id, clerk_user_id, last_read_at)
select c.id, cu.clerk_user_id, now()
from public.conversations c
cross join public.client_users cu
where cu.role = 'admin'
on conflict (conversation_id, clerk_user_id) do nothing;

-- ---------- notifications: members only (no more whole-client fan-out) ----------
-- Before 0018 every client user was notified of every message, which would leak
-- private-thread previews to teammates. Now only the thread's members hear
-- about it, and client senders are named for their teammates.
create or replace function public.notify_on_message()
returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; preview text; sender_name text;
begin
  preview := case when coalesce(NEW.body, '') = ''
    then 'Sent an attachment' else left(NEW.body, 140) end;
  select full_name into sender_name
  from public.client_users where clerk_user_id = NEW.sender_user_id;

  if NEW.sender_role = 'admin' then
    for r in
      select m.clerk_user_id
      from public.conversation_members m
      join public.client_users cu
        on cu.clerk_user_id = m.clerk_user_id and cu.role = 'client'
      where m.conversation_id = NEW.conversation_id
        and m.clerk_user_id <> NEW.sender_user_id
    loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'message', 'New message from Kyle', preview, '/messages', 'instant');
    end loop;
  else
    for r in
      select clerk_user_id from public.client_users where role = 'admin'
    loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'message',
              'New message from ' || coalesce(sender_name, 'a client'), preview, '/admin/messages', 'in_portal');
    end loop;
    -- Fellow members in a group chat hear about it too.
    for r in
      select m.clerk_user_id
      from public.conversation_members m
      join public.client_users cu
        on cu.clerk_user_id = m.clerk_user_id and cu.role = 'client'
      where m.conversation_id = NEW.conversation_id
        and m.clerk_user_id <> NEW.sender_user_id
    loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'message',
              'New message from ' || coalesce(sender_name, 'your team'), preview, '/messages', 'instant');
    end loop;
  end if;
  return NEW;
end $$;
drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_on_message();

-- ---------- unread counts (nav badge + conversation lists) ----------
-- SECURITY INVOKER on purpose: RLS trims it to threads the caller can see, and
-- the restrictive policy keeps soft-deleted threads out.
create or replace function public.unread_message_counts()
returns table (conversation_id uuid, unread bigint)
language sql stable as $$
  select m.conversation_id, count(*)::bigint
  from public.messages m
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id
   and cm.clerk_user_id = public.clerk_user_id()
  where m.sender_user_id <> public.clerk_user_id()
    and (cm.last_read_at is null or m.created_at > cm.last_read_at)
  group by m.conversation_id;
$$;
grant execute on function public.unread_message_counts() to authenticated;

-- ---------- teammates are visible to each other ----------
-- Needed for sender names in group chats and "Seen by" receipts. Same-company
-- only; a user still can't see users of any other client.
drop policy if exists client_users_peer_read on public.client_users;
create policy client_users_peer_read on public.client_users
  for select to authenticated
  using (client_id is not null and client_id = public.current_client_id());

-- ---------- realtime: instant delivery + live receipts ----------
-- RLS applies per subscriber, so nobody receives events for threads they
-- cannot see. Polling stays in the app as a backstop.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.conversation_members;
exception when duplicate_object then null; end $$;
