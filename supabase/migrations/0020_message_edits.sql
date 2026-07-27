-- =============================================================================
-- Hartwell Pulse — 0020 message edits
-- Adds messages.edited_at plus a guard trigger that stamps it server-side
-- whenever a signed-in user changes a message body, so an edit can never hide
-- itself. The same trigger freezes every other column under a JWT (same
-- pattern as notifications_client_guard). Clients remain unable to edit at
-- all: they have no UPDATE policy on messages. Kyle edits via
-- messages_admin_all. Typing indicators ship in the same release but are
-- realtime broadcast only — no schema needed. Run after 0019. Idempotent.
-- =============================================================================

alter table public.messages add column if not exists edited_at timestamptz;

create or replace function public.messages_edit_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.clerk_user_id() is not null then
    if new.body is distinct from old.body then
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;
    new.conversation_id := old.conversation_id;
    new.client_id := old.client_id;
    new.sender_user_id := old.sender_user_id;
    new.sender_role := old.sender_role;
    new.attachments := old.attachments;
    new.created_at := old.created_at;
    new.read_at := old.read_at;
  end if;
  return new;
end $$;
drop trigger if exists messages_edit_guard_update on public.messages;
create trigger messages_edit_guard_update
  before update on public.messages
  for each row execute function public.messages_edit_guard();
