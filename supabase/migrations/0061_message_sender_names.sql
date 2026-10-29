-- 0061: name the team member who sent a message, by first name.
--
-- Clients were told every message was "New message from Kyle", whoever sent
-- it. With the team growing, a client is now told the sender's first name
-- ("New message from Sam"), never a surname, and "Hartwell Digital" when a
-- team account has no name on it. This is the function from 0018 with that
-- one line changed; the trigger already points at it.
--
-- Safe to run more than once.

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
      values (r.clerk_user_id, NEW.client_id, 'message',
              'New message from ' || coalesce(nullif(split_part(trim(coalesce(sender_name, '')), ' ', 1), ''), 'Hartwell Digital'),
              preview, '/messages', 'instant');
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
