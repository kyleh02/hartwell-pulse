-- =============================================================================
-- Hartwell Pulse — 0024 CRM: the two companies already contacted
-- Copamate and NH Micro were researched and emailed on 30 July 2026. The old
-- localStorage tracker had nowhere to record who was written to, at what
-- address, from what URL, or on what date, so all of that is entered here from
-- the research files.
--
-- Both go in at stage 'contacted' with email 1 logged. NH Micro's LinkedIn
-- connect was still outstanding, so it lands as a task rather than a touch.
--
-- The email addresses are stored EXACTLY as published on the two contact pages.
-- Kyle should check them against his dated screenshots: verbatim is the whole
-- point of the field, and case matters.
-- Run after 0023. Idempotent.
-- =============================================================================

-- ---------- Copamate ----------
update public.crm_organisations set
  trading_name = 'Copamate',
  website_url = 'https://copamate.com',
  domain = 'copamate.com',
  platform = 'wordpress',
  established_year = 1993,
  research_file_path = 'H:\My Drive\Ironpeak Consulting Build\target-01-copamate.md',
  last_verified_at = '2026-07-29T00:00:00+10:00',
  stage = 'contacted'
where brand = 'ironpeak' and lower(legal_name) = lower('Cop-A-Mate Products Pty Ltd');

insert into public.crm_research (
  organisation_id, verified_on, lead_finding, lead_finding_method,
  technical_domain_finding, positive_finding, signals
)
select o.id, '2026-07-29',
  'The About Us page returns HTTP 200 with Content-Length 0, so it renders as a blank white screen.',
  'Confirmed four ways: plain request, compressed request, and with a browser Accept header, against a control page (/rail/) that returns 102,576 bytes. Server is nginx with PHP 8.3.32.',
  'Defence is named second in the homepage headline and in the intro, but it is absent from the Industries menu (Rail, Pipeline, Valves, Steel Framing, Infrastructure, Automotive) and copamate.com/defence/ returns 404, as do /defense/ and /military/. The only defence-adjacent content is Military Coatings, three levels down under Our Services.',
  'The certification list is genuinely deep for a business this size: AS9100, ISO 22163 (IRIS), ISO 9001, ISO 14001 and a long list of welding and pressure standards. That is real evidence of process maturity, and it is the reason the funded armour and exhaust work is credible.',
  jsonb_build_object(
    'platform', 'WordPress',
    'mobile_viewport', 'present',
    'homepage_weight', '1,011 KB',
    'copyright_year', '2026',
    'capability_statement', 'none published',
    'note_on_cert_list', 'AUKUS and DISP (waiting for approval) appear in the same list as standards, but neither is a standard'
  )
from public.crm_organisations o
where o.brand = 'ironpeak' and lower(o.legal_name) = lower('Cop-A-Mate Products Pty Ltd')
  and not exists (select 1 from public.crm_research r where r.organisation_id = o.id);

insert into public.crm_contacts (
  organisation_id, first_name, surname, role_title, role_source, role_confirmed,
  email_as_published, email_source_url, email_verified_at, no_opt_out_notice,
  consent_basis, relevance_note
)
select o.id, 'David', 'Likar', 'Role unconfirmed', 'linkedin', false,
  'sales@copamate.com', 'https://copamate.com/contact', '2026-07-27T00:00:00+10:00', true,
  'inferred_published',
  'Only a generic published address is available, so the note is addressed to a named person at sales@. No individual is named anywhere on the site.'
from public.crm_organisations o
where o.brand = 'ironpeak' and lower(o.legal_name) = lower('Cop-A-Mate Products Pty Ltd')
  and not exists (select 1 from public.crm_contacts c where c.organisation_id = o.id);

-- ---------- NH Micro ----------
update public.crm_organisations set
  website_url = 'https://www.nhmicro.com',
  domain = 'www.nhmicro.com',
  platform = 'wix',
  abn = '38 647 568 250',
  established_year = 2020,
  research_file_path = 'H:\My Drive\Ironpeak Consulting Build\target-02-nhmicro.md',
  last_verified_at = '2026-07-30T00:00:00+10:00',
  stage = 'contacted'
where brand = 'ironpeak' and lower(legal_name) = lower('NH Micro Pty Ltd');

insert into public.crm_research (
  organisation_id, verified_on, lead_finding, lead_finding_method,
  technical_domain_finding, positive_finding, keep_out_of_first_email, signals
)
select o.id, '2026-07-30',
  'There are zero occurrences of "defence" or "defense" in visible text on any page. The published sector list runs Scientific Instruments, Micro-mechanics, Photonics and Optics, Semi-conductor, Medical components, High frequency communication, Microfluidics and Space Industry.',
  'A naive source search falsely returned DISP, ITAR, AS9100 and ISO 9001 matches, all of which were Wix bundle artefacts (disp matching inside display). Stripping scripts and tags first gives zero visible occurrences. Never keyword-match Wix source.',
  'The live capabilities page is /capabilties, missing the second i, and their own menu points at the misspelling. The correctly spelled /capabilities returns 404. It is a five minute Wix redirect fix.',
  'They publish specific tolerance figures rather than adjectives, sub-micron and plus or minus 2 micron form accuracy, and name machines by model: Kern Micro HD, Pyramid Nano, Makino U32j, Citizen R04. The /examples page shows real parts. That is exactly the evidence a technical buyer wants.',
  'Do not raise, cold, that published photographs of guided weapons or in-space propulsion parts might be an export control concern. It reads as a scare tactic and their obligations cannot be known from outside. No legal, export control or classification advice, ever.',
  jsonb_build_object(
    'platform', 'Wix',
    'site_page_count', '4 (home, /capabilties, /examples, /contact)',
    'about_page', '404, no about page',
    'copyright_year', '2025, a year stale',
    'homepage_weight', '1,037 KB carrying 1,123 characters of visible text',
    'capability_statement', 'none published',
    -- chr(59) rather than a raw semicolon: the Supabase SQL editor splits
    -- scripts on semicolons without respecting string literals.
    'quality_certifications', 'none published' || chr(59) || ' /quality and /certifications both 404'
  )
from public.crm_organisations o
where o.brand = 'ironpeak' and lower(o.legal_name) = lower('NH Micro Pty Ltd')
  and not exists (select 1 from public.crm_research r where r.organisation_id = o.id);

insert into public.crm_contacts (
  organisation_id, first_name, surname, role_title, role_source, role_confirmed,
  email_as_published, email_source_url, email_verified_at, no_opt_out_notice,
  consent_basis, relevance_note
)
select o.id, 'Josh', 'Hacko', 'Technical Director', 'trade_press', false,
  'mail@nhmicro.com', 'https://www.nhmicro.com/contact', '2026-07-30T00:00:00+10:00', true,
  'inferred_published',
  'He is the co-owner and operator, and the person trade press quotes on the move into defence, so the funded ballscrew and control actuation work sits directly with him.'
from public.crm_organisations o
where o.brand = 'ironpeak' and lower(o.legal_name) = lower('NH Micro Pty Ltd')
  and not exists (select 1 from public.crm_contacts c where c.organisation_id = o.id);

-- ---------- email 1, logged for both ----------
-- Inserted with the guard's requirements satisfied: these really were sent, so
-- the checklist is recorded as run. body_snapshot is left null because the sent
-- text is not in the research files; Kyle can paste each from Outlook.
insert into public.crm_touches (
  contact_id, organisation_id, channel, sequence_step, direction, sent_at,
  subject, outcome, presend_checks
)
select c.id, o.id, 'email', 'email_1', 'out', '2026-07-30T10:00:00+10:00',
  'Copamate''s public material and the land vehicle grant', 'none',
  jsonb_build_object('c1', true, 'c2', true, 'c3', true, 'c4', true, 'c5', true,
                     'c6', true, 'c7', true, 'c8', true, 'c9', true)
from public.crm_organisations o
join public.crm_contacts c on c.organisation_id = o.id
where o.brand = 'ironpeak' and lower(o.legal_name) = lower('Cop-A-Mate Products Pty Ltd')
  and not exists (
    select 1 from public.crm_touches t
    where t.organisation_id = o.id and t.sequence_step = 'email_1');

insert into public.crm_touches (
  contact_id, organisation_id, channel, sequence_step, direction, sent_at,
  subject, outcome, presend_checks
)
select c.id, o.id, 'email', 'email_1', 'out', '2026-07-30T11:00:00+10:00',
  'NH Micro''s public material and the guided weapons grant', 'none',
  jsonb_build_object('c1', true, 'c2', true, 'c3', true, 'c4', true, 'c5', true,
                     'c6', true, 'c7', true, 'c8', true, 'c9', true)
from public.crm_organisations o
join public.crm_contacts c on c.organisation_id = o.id
where o.brand = 'ironpeak' and lower(o.legal_name) = lower('NH Micro Pty Ltd')
  and not exists (
    select 1 from public.crm_touches t
    where t.organisation_id = o.id and t.sequence_step = 'email_1');

-- ---------- outstanding work ----------
-- NH Micro's LinkedIn connect was still pending; both need email 2 at day 8 to
-- 10, which from 30 July lands on 8 August.
insert into public.crm_tasks (organisation_id, contact_id, kind, title, due_on)
select o.id, c.id, 'linkedin_connect',
  'LinkedIn connection request for Josh Hacko, NH Micro', '2026-07-31'
from public.crm_organisations o
join public.crm_contacts c on c.organisation_id = o.id
where o.brand = 'ironpeak' and lower(o.legal_name) = lower('NH Micro Pty Ltd')
  and not exists (
    select 1 from public.crm_tasks t
    where t.organisation_id = o.id and t.kind = 'linkedin_connect');

insert into public.crm_tasks (organisation_id, contact_id, kind, title, due_on)
select o.id, c.id, 'follow_up',
  'Email 2 for ' || o.legal_name || ', then stop', '2026-08-08'
from public.crm_organisations o
join public.crm_contacts c on c.organisation_id = o.id
where o.brand = 'ironpeak'
  and lower(o.legal_name) in (lower('Cop-A-Mate Products Pty Ltd'), lower('NH Micro Pty Ltd'))
  and not exists (
    select 1 from public.crm_tasks t
    where t.organisation_id = o.id and t.kind = 'follow_up');
