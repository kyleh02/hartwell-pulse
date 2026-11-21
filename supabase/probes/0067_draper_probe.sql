-- =============================================================================
-- Draper, three new faults: probe. Paste into the Supabase SQL Editor AFTER
-- 0067, then Run. Changes nothing. Every row should say pass = true.
-- =============================================================================

select 'every fault list accepts the three new faults' as test,
       count(*) || ' of 4' as result,
       count(*) = 4 as pass
from pg_constraint c
where c.conname in ('outreach_measurements_faults_check', 'outreach_messages_fault_check', 'outreach_claims_fault_check', 'outreach_state_faults_check')
  and pg_get_constraintdef(c.oid) like '%layout_shift%'
  and pg_get_constraintdef(c.oid) like '%page_freezes%'
  and pg_get_constraintdef(c.oid) like '%no_mobile_layout%'
union all
select 'the six original faults are all still allowed',
       count(*) || ' of 4',
       count(*) = 4
from pg_constraint c
where c.conname in ('outreach_measurements_faults_check', 'outreach_messages_fault_check', 'outreach_claims_fault_check', 'outreach_state_faults_check')
  and pg_get_constraintdef(c.oid) like '%slow_mobile%'
  and pg_get_constraintdef(c.oid) like '%broken_page%'
  and pg_get_constraintdef(c.oid) like '%not_secure%'
  and pg_get_constraintdef(c.oid) like '%phone_not_tappable%'
  and pg_get_constraintdef(c.oid) like '%pixel_double%'
  and pg_get_constraintdef(c.oid) like '%old_analytics%'
union all
select 'measurements keep the new readings',
       count(*) || ' of 3',
       count(*) = 3
from information_schema.columns
where table_schema = 'public' and table_name = 'outreach_measurements'
  and column_name in ('psi_cls', 'psi_tbt_ms', 'mobile_viewport');
