-- =============================================================================
-- Draper, Stage 6 probe. Paste into the Supabase SQL Editor AFTER 0066, then Run.
-- Changes nothing. Every row should say pass = true.
-- =============================================================================

select 'settings can send on weekends (off by default)' as test,
       coalesce(max(column_default), 'missing') as result,
       coalesce(max(column_default), '') = 'false' as pass
from information_schema.columns
where table_schema = 'public' and table_name = 'outreach_settings' and column_name = 'send_weekends'
union all
select 'the state row has the reply columns',
       count(*) || ' of 2',
       count(*) = 2
from information_schema.columns
where table_schema = 'public' and table_name = 'outreach_state'
  and column_name in ('replies_checked_at', 'auto_rules_since')
union all
select 'leads accept the outreach source',
       case when pg_get_constraintdef(c.oid) like '%''outreach''%' then 'yes' else 'NO' end,
       pg_get_constraintdef(c.oid) like '%''outreach''%'
from pg_constraint c
where c.conname = 'leads_source_check' and c.conrelid = 'public.leads'::regclass
union all
select 'the old lead sources are all still allowed',
       case when pg_get_constraintdef(c.oid) like '%''website''%' and pg_get_constraintdef(c.oid) like '%''manual''%' and pg_get_constraintdef(c.oid) like '%''other''%' then 'yes' else 'NO' end,
       pg_get_constraintdef(c.oid) like '%''website''%' and pg_get_constraintdef(c.oid) like '%''manual''%' and pg_get_constraintdef(c.oid) like '%''other''%'
from pg_constraint c
where c.conname = 'leads_source_check' and c.conrelid = 'public.leads'::regclass
union all
select 'only one check on the lead source (no old one left refusing outreach)',
       count(*) || ' check',
       count(*) = 1
from pg_constraint c
where c.conrelid = 'public.leads'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%source%'
union all
select 'replies are indexed by prospect',
       count(*) || ' index',
       count(*) = 1
from pg_indexes
where schemaname = 'public' and tablename = 'outreach_replies' and indexname = 'outreach_replies_prospect_idx';
