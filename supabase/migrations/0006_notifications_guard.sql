-- =============================================================================
-- Hartwell Pulse — 0006 harden notification updates
-- Final-QA finding (low): a recipient could change their own notification's
-- channel/emailed_at (self-affecting only, no cross-tenant access). Lock it so
-- the only column a client/admin can UPDATE via the API is read_at.
-- Run after 0004/0005.
-- =============================================================================

-- Column-level privilege is the robust gate. Service role (cron) and the
-- SECURITY DEFINER triggers bypass this, so server-side writes are unaffected.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Keep the guard trigger in sync too (defence in depth), now that 0004 added
-- channel + emailed_at.
create or replace function public.notifications_client_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.clerk_user_id() is not null and not public.is_admin() then
    new.recipient_user_id := old.recipient_user_id;
    new.client_id := old.client_id;
    new.type := old.type;
    new.title := old.title;
    new.body := old.body;
    new.link := old.link;
    new.channel := old.channel;
    new.emailed_at := old.emailed_at;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
