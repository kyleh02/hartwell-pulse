-- 0059: the portal assistant (Stage 8).
--
-- "Quick answers" in the client's chat panel: Claude (Opus 5.5) answering
-- questions about the portal, their account and Hartwell Digital's services,
-- from what Kyle has approved. Every conversation is kept, and Kyle is emailed
-- one summary per conversation once it has gone quiet.
--
-- A client only READS their own conversations, through RLS. Everything is
-- written by /api/assistant with the service role after it has checked who is
-- asking. Off until Kyle switches it on in Settings AND an ANTHROPIC_API_KEY is
-- set in Vercel.
--
-- Safe to run more than once.

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id text not null,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count int not null default 0,
  handed_off boolean not null default false,
  emailed_at timestamptz
);
create index if not exists assistant_conversations_user_idx on public.assistant_conversations (user_id, last_message_at desc);
create index if not exists assistant_conversations_unsent_idx on public.assistant_conversations (last_message_at) where emailed_at is null;

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  handed_off boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_conv_idx on public.assistant_messages (conversation_id, created_at);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
grant select on public.assistant_conversations, public.assistant_messages to authenticated;

drop policy if exists assistant_conversations_admin_all on public.assistant_conversations;
create policy assistant_conversations_admin_all on public.assistant_conversations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists assistant_conversations_own_read on public.assistant_conversations;
create policy assistant_conversations_own_read on public.assistant_conversations
  for select to authenticated
  using (client_id = public.current_client_id() and user_id = public.clerk_user_id());

drop policy if exists assistant_messages_admin_all on public.assistant_messages;
create policy assistant_messages_admin_all on public.assistant_messages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists assistant_messages_own_read on public.assistant_messages;
create policy assistant_messages_own_read on public.assistant_messages
  for select to authenticated
  using (exists (
    select 1 from public.assistant_conversations c
    where c.id = conversation_id
      and c.client_id = public.current_client_id()
      and c.user_id = public.clerk_user_id()
  ));

alter table public.business_settings add column if not exists assistant_enabled boolean not null default false;
alter table public.business_settings add column if not exists assistant_knowledge text;

notify pgrst, 'reload schema';
