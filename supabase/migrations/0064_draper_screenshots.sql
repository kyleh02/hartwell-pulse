-- =============================================================================
-- 0064: Draper, Stage 3. A private bucket for measurement screenshots.
--
-- Each measurement keeps PageSpeed's phone screenshot as part of the proof
-- (src/lib/outreach/store.ts writes screenshots/<prospect>/<measurement>.jpg).
-- The bucket is private and has NO storage policies, so only the service
-- role, in the portal's own server code, can read or write it. Kyle's pages
-- show a screenshot through a short-lived signed URL made on the server.
-- It is deliberately not pulse-assets, whose policies are built around a
-- client id as the first folder: these files belong to no client.
--
-- Safe to run more than once.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('outreach', 'outreach', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
