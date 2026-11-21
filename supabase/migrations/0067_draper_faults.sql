-- =============================================================================
-- 0067: Draper. Three more faults (Kyle, 21 November 2026).
--
-- The first morning run read 15 sites in the 4WD lane and submitted none:
-- most were only slow on a phone, and a prospect needs two different faults,
-- one for each email. Kyle chose to add three more that the same measurement
-- already shows, none needing a form sent:
--
--   layout_shift      the page jumps about while it loads (Google's layout
--                     shift score 0.25 or more, its "poor" line)
--   page_freezes      the page can't respond for a stretch after it shows
--                     (Google's total blocking time 600 ms or more on a phone)
--   no_mobile_layout  the page isn't set up for phones (no device-width
--                     viewport tag), so a phone shows the desktop page shrunk
--
-- Each check constraint that lists the faults is replaced with all nine, and
-- the measurements keep the readings behind the new ones. Nothing is dropped
-- or rewritten. Safe to run more than once.
-- =============================================================================

alter table public.outreach_measurements drop constraint if exists outreach_measurements_faults_check;
alter table public.outreach_measurements add constraint outreach_measurements_faults_check check (faults <@ array['slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics', 'layout_shift', 'page_freezes', 'no_mobile_layout']::text[]);

alter table public.outreach_messages drop constraint if exists outreach_messages_fault_check;
alter table public.outreach_messages add constraint outreach_messages_fault_check check (fault in ('slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics', 'layout_shift', 'page_freezes', 'no_mobile_layout'));

alter table public.outreach_claims drop constraint if exists outreach_claims_fault_check;
alter table public.outreach_claims add constraint outreach_claims_fault_check check (fault in ('slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics', 'layout_shift', 'page_freezes', 'no_mobile_layout'));

alter table public.outreach_state drop constraint if exists outreach_state_faults_check;
alter table public.outreach_state add constraint outreach_state_faults_check check (faults_off <@ array['slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics', 'layout_shift', 'page_freezes', 'no_mobile_layout']::text[]);

alter table public.outreach_measurements
  add column if not exists psi_cls numeric(6, 3) check (psi_cls >= 0),
  add column if not exists psi_tbt_ms int check (psi_tbt_ms >= 0),
  add column if not exists mobile_viewport boolean;

notify pgrst, 'reload schema';
