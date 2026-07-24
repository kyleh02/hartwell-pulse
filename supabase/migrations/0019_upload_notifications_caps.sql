-- =============================================================================
-- Hartwell Pulse — 0019 upload notifications + file size caps
-- 1) notify_on_asset_upload gets useful: Kyle's notification now says WHICH
--    client and WHO uploaded WHAT, and client users now hear when Kyle drops a
--    new file in for them (digest channel: bell straight away, email in the
--    daily digest, no instant email spam).
-- 2) Hard 50 MB per-file cap on both storage buckets, enforced by Supabase
--    itself. The app shows friendly limits before ever hitting this.
-- Run after 0018. Idempotent.
-- =============================================================================

create or replace function public.notify_on_asset_upload()
returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; uploader text; biz text;
begin
  select full_name into uploader
  from public.client_users where clerk_user_id = NEW.uploaded_by;
  select business_name into biz
  from public.clients where id = NEW.client_id;

  if NEW.uploader_role = 'client' then
    for r in select clerk_user_id from public.client_users where role = 'admin' loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'asset_uploaded',
              'New upload from ' || coalesce(biz, 'a client'),
              coalesce(uploader || ': ', '') || NEW.name,
              '/admin/assets', 'in_portal');
    end loop;
  else
    for r in
      select clerk_user_id from public.client_users
      where client_id = NEW.client_id and role = 'client'
    loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'asset_uploaded',
              'Kyle added a new file', NEW.name, '/assets', 'digest');
    end loop;
  end if;
  return NEW;
end $$;

-- The assets_notify trigger from 0004 already points at this function; no
-- trigger change needed.

-- ---------- per-file upload cap: 50 MB on both buckets ----------
update storage.buckets set file_size_limit = 52428800 where id = 'pulse-assets';
update storage.buckets set file_size_limit = 52428800 where id = 'pulse-reports';
