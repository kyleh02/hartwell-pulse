-- =============================================================================
-- Draper, Stage 3 probe. Paste into the Supabase SQL Editor AFTER 0064, then Run.
-- Changes nothing. Every row should say pass = true.
-- =============================================================================

select 'the outreach bucket exists' as test,
       coalesce((select 'there' from storage.buckets where id = 'outreach'), 'missing') as result,
       exists (select 1 from storage.buckets where id = 'outreach') as pass
union all
select 'the outreach bucket is private',
       coalesce((select case when public then 'PUBLIC' else 'private' end from storage.buckets where id = 'outreach'), 'missing'),
       coalesce((select not public from storage.buckets where id = 'outreach'), false)
union all
select 'no storage policy mentions the outreach bucket',
       (select count(*) || ' policies' from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and (coalesce(qual, '') || coalesce(with_check, '')) like '%outreach%'),
       (select count(*) = 0 from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and (coalesce(qual, '') || coalesce(with_check, '')) like '%outreach%');
