-- =============================================================================
-- 0071: Draper. Two tracking gaps (Kyle, 27 November 2026).
--
-- The paper test of 27 November ("Draper paper test, 27 Nov 2026.md" in Drive)
-- found one finding strong enough to write to a business about: ads running
-- to a website that can't measure them. Kyle made it the rule the same day.
-- Two new faults, both read from the same measurement (the page, its Google
-- Tag Manager container, Shopify's pixel settings and the requests Google's
-- phone test saw):
--
--   no_meta_pixel   no Meta Pixel anywhere on the page
--   no_google_tag   no Google tag of any kind (no Google Ads tag, no Google
--                   Analytics, no tag manager tag for either)
--
-- Each check constraint that lists the faults is replaced with all eleven.
-- Nothing is dropped or rewritten. Safe to run more than once, and safe to
-- run before the code that uses it.
-- =============================================================================

alter table public.outreach_measurements drop constraint if exists outreach_measurements_faults_check;
alter table public.outreach_measurements add constraint outreach_measurements_faults_check check (faults <@ array['slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics', 'layout_shift', 'page_freezes', 'no_mobile_layout', 'no_meta_pixel', 'no_google_tag']::text[]);

alter table public.outreach_messages drop constraint if exists outreach_messages_fault_check;
alter table public.outreach_messages add constraint outreach_messages_fault_check check (fault in ('slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics', 'layout_shift', 'page_freezes', 'no_mobile_layout', 'no_meta_pixel', 'no_google_tag'));

alter table public.outreach_claims drop constraint if exists outreach_claims_fault_check;
alter table public.outreach_claims add constraint outreach_claims_fault_check check (fault in ('slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics', 'layout_shift', 'page_freezes', 'no_mobile_layout', 'no_meta_pixel', 'no_google_tag'));

alter table public.outreach_state drop constraint if exists outreach_state_faults_check;
alter table public.outreach_state add constraint outreach_state_faults_check check (faults_off <@ array['slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics', 'layout_shift', 'page_freezes', 'no_mobile_layout', 'no_meta_pixel', 'no_google_tag']::text[]);

notify pgrst, 'reload schema';

-- Check: four constraints, each listing both new faults (expect four rows, all true).
select conname, pg_get_constraintdef(oid) like '%no_meta_pixel%' and pg_get_constraintdef(oid) like '%no_google_tag%' as has_new_faults
from pg_constraint
where conname in ('outreach_measurements_faults_check', 'outreach_messages_fault_check', 'outreach_claims_fault_check', 'outreach_state_faults_check')
order by 1;
