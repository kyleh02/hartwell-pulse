-- =============================================================================
-- Draper, run reports: probe. Paste into the Supabase SQL Editor AFTER 0068,
-- then Run. Changes nothing. Every row should say pass = true.
-- =============================================================================

select 'the run report table is there' as test,
       count(*) || ' of 1' as result,
       count(*) = 1 as pass
from information_schema.tables
where table_schema = 'public' and table_name = 'outreach_runs'
union all
select 'it has every column',
       count(*) || ' of 12',
       count(*) = 12
from information_schema.columns
where table_schema = 'public' and table_name = 'outreach_runs'
  and column_name in ('id', 'ran_on', 'sites_read', 'added', 'measured', 'submitted', 'dropped', 'skipped', 'dropped_reasons', 'summary', 'test', 'created_by')
union all
select 'row-level security is on',
       case when c.relrowsecurity then 'yes' else 'NO' end,
       c.relrowsecurity
from pg_class c
where c.oid = 'public.outreach_runs'::regclass
union all
select 'admins read and add, nothing more',
       string_agg(p.cmd, ', ' order by p.cmd),
       string_agg(p.cmd, ', ' order by p.cmd) = 'INSERT, SELECT'
from pg_policies p
where p.schemaname = 'public' and p.tablename = 'outreach_runs';
