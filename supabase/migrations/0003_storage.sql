-- =============================================================================
-- Hartwell Pulse — 0003 storage buckets + policies
-- Run after 0002_rls.sql.
--
-- Convention: every object is stored under its client's id as the first folder,
-- e.g.  pulse-assets/<client_id>/social/header.png
--       pulse-reports/<client_id>/2026-06.pdf
-- RLS on storage.objects keys off that first folder, so a client can only reach
-- files inside their own client_id prefix. Both buckets are private; the app
-- hands out short-lived signed URLs.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('pulse-assets', 'pulse-assets', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('pulse-reports', 'pulse-reports', false)
on conflict (id) do nothing;

-- ---------- pulse-assets: clients read + write within their own prefix ----------
create policy "pulse_assets_admin_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'pulse-assets' and public.is_admin())
  with check (bucket_id = 'pulse-assets' and public.is_admin());

create policy "pulse_assets_client_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );

create policy "pulse_assets_client_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );

create policy "pulse_assets_client_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  )
  with check (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );

create policy "pulse_assets_client_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pulse-assets'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );

-- ---------- pulse-reports: admin writes, clients read their own ----------
create policy "pulse_reports_admin_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'pulse-reports' and public.is_admin())
  with check (bucket_id = 'pulse-reports' and public.is_admin());

create policy "pulse_reports_client_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pulse-reports'
    and (storage.foldername(name))[1] = public.current_client_id()::text
  );
