-- =============================================================================
-- Draper, Stage 5 probe. Paste into the Supabase SQL Editor AFTER 0065, then Run.
-- Changes nothing. Every row should say pass = true.
-- =============================================================================

select 'notifications accept the outreach type' as test,
       case when pg_get_constraintdef(c.oid) like '%''outreach''%' then 'yes' else 'NO' end as result,
       pg_get_constraintdef(c.oid) like '%''outreach''%' as pass
from pg_constraint c
where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass
union all
select 'messages have the sending columns',
       count(*) || ' of 3',
       count(*) = 3
from information_schema.columns
where table_schema = 'public' and table_name = 'outreach_messages'
  and column_name in ('confirmed_at', 'send_attempts', 'send_error')
union all
select 'the state row has the tick columns',
       count(*) || ' of 3',
       count(*) = 3
from information_schema.columns
where table_schema = 'public' and table_name = 'outreach_state'
  and column_name in ('queue_fixed_on', 'tick_at', 'tick_note')
union all
select 'the old notification types are all still allowed',
       case when pg_get_constraintdef(c.oid) like '%''lead''%' and pg_get_constraintdef(c.oid) like '%''message''%' then 'yes' else 'NO' end,
       pg_get_constraintdef(c.oid) like '%''lead''%' and pg_get_constraintdef(c.oid) like '%''message''%'
from pg_constraint c
where c.conname = 'notifications_type_check' and c.conrelid = 'public.notifications'::regclass;
