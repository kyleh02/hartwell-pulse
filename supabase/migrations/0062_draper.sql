-- =============================================================================
-- 0062: Draper, Stage 1. Every table automatic outreach needs, admins only
--
-- Draper (docs/DRAPER.md) finds small businesses with ad tracking and faults
-- Pulse can measure on their own sites, and emails each one a short plain-text
-- note from kyle@hartwelldigital.com. This migration is its data and nothing
-- else: no code reads it until OUTREACH_ENABLED is on in Vercel, and nothing
-- can send until later stages add a sender AND Kyle turns the master switch on
-- and test mode off by hand. Settings version 1 has the master switch OFF and
-- test mode ON.
--
-- Who can touch what:
--   * Every table has RLS on. Admins read and write through public.is_admin();
--     a signed-in client and a signed-out visitor get nothing at all.
--   * Records that must never change can only be added to: settings,
--     templates, run instructions, lessons, the change log and events.
--   * Suppression fingerprints can never be changed or deleted by anyone,
--     including the service role: a trigger refuses it. TRUNCATE too.
--   * A message that really went out (not a test-mode send) can never be
--     deleted, so a prospect with one cannot be deleted either: a cascade
--     reaches the same trigger.
--   * outreach_gmail holds the encrypted Gmail refresh token. RLS on, no
--     policies, no grants: service role only, never a browser.
--
-- The database also holds the line on a few rules itself, so a bug upstream
-- cannot get past them:
--   * one prospect per domain, and one contact address per prospect;
--   * a first email and at most one follow-up per business (unique on
--     prospect and kind);
--   * the daily slider is 1 to 25 and can't be set past it;
--   * lane 4 (defence) can't be added: Ironpeak trades in defence under the
--     same ABN, and Kyle left it out on 19 November 2026 (decision 8).
--
-- Seeded from Kyle's brief: lanes 1, 2, 3 and 5 (lane 1 active), settings v1,
-- template v1 (his wording, with named slots) and run instructions v1. The
-- postcode and holiday tables are created empty; later stages load them.
--
-- Run after 0061. Safe to run more than once: re-running never overwrites a
-- seeded row Kyle has since changed.
-- =============================================================================

-- ---------- 0. guards ----------
-- Refuses any change to a row. Used on tables that are a permanent record.
create or replace function public.outreach_refuse_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is a permanent record: rows can be added, never changed or removed', TG_TABLE_NAME
    using errcode = 'restrict_violation';
end $$;

-- A message that went to a real business is the record of what was sent.
-- Test-mode sends went to Kyle's own inboxes and may be cleared.
create or replace function public.outreach_messages_keep_sent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if OLD.sent_at is not null and not coalesce(OLD.test_mode, false) then
    raise exception 'A message sent to a business is a permanent record and cannot be deleted'
      using errcode = 'restrict_violation';
  end if;
  return OLD;
end $$;

-- ---------- 1. versioned records: settings, templates, run instructions, lessons ----------
-- A change is a new row with the next version number. Every message records
-- the template version it was written to and the settings version in force
-- when it went.

create table if not exists public.outreach_templates (
  version int primary key check (version > 0),
  first_subject text not null,
  first_body text not null,
  followup_subject text not null,
  followup_body text not null,
  -- The follow-up's closing line, chosen by settings.opt_out_line.
  opt_out_a text not null,
  opt_out_b text not null,
  -- What Claude is told about the slots, returned by outreach_brief.
  slot_rules text not null,
  example text,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_run_instructions (
  version int primary key check (version > 0),
  body text not null,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_lessons (
  version int primary key check (version > 0),
  body text not null,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_settings (
  version int primary key check (version > 0),
  -- Both switches change by Kyle's hand only. Off and on, as shipped.
  master_on boolean not null default false,
  test_mode boolean not null default true,
  test_inboxes text[] not null default '{}' check (cardinality(test_inboxes) <= 5),
  -- First emails a weekday. The code's hard ceilings (25 first emails, 50
  -- sends) sit above this and no setting raises them.
  daily_first_emails int not null default 5 constraint outreach_settings_daily_check check (daily_first_emails between 1 and 25),
  window_start time not null default '09:30',
  window_end time not null default '15:30',
  gap_min_minutes int not null default 20 check (gap_min_minutes between 10 and 120),
  gap_max_minutes int not null default 45 check (gap_max_minutes between 10 and 180),
  stop_window_minutes int not null default 90 check (stop_window_minutes between 0 and 300),
  pause_from date default '2026-12-18',
  pause_to date default '2027-01-11',
  opt_out_line text not null default 'A' check (opt_out_line in ('A', 'B')),
  client_radius_km numeric(5, 1) not null default 15 check (client_radius_km > 0 and client_radius_km <= 200),
  -- Kinds of business never approached in any lane. Returned to Claude.
  never_list text[] not null default '{}',
  -- Kyle's private categories to skip. Claude never sees these; a check
  -- returns only allowed or blocked.
  exclusion_categories text[] not null default '{}',
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  check (window_start >= '07:00' and window_end <= '18:00' and window_start < window_end),
  check (gap_max_minutes >= gap_min_minutes),
  check (pause_from is null or pause_to is null or pause_from <= pause_to)
);

-- ---------- 2. lanes ----------
create table if not exists public.outreach_lanes (
  -- The lane's number in Kyle's brief.
  id smallint primary key,
  name text not null,
  services text[] not null default '{}',
  areas text[] not null default '{}',
  skip text[] not null default '{}',
  template_version int not null default 1 references public.outreach_templates(version),
  approval_required boolean not null default false,
  active boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_lanes_id_check check (id between 1 and 99),
  constraint outreach_lanes_no_defence check (id <> 4)
);
-- One active lane at a time.
create unique index if not exists outreach_lanes_one_active on public.outreach_lanes ((true)) where active;

-- ---------- 3. the switches that change minute to minute: one row ----------
create table if not exists public.outreach_state (
  id boolean primary key default true check (id),
  -- Pause all: Kyle's switch on the Outreach page, or an auto-pause rule.
  paused boolean not null default false,
  paused_reason text,
  paused_by text check (paused_by in ('kyle', 'auto')),
  paused_at timestamptz,
  -- Faults switched off after two "wrong fact" labels, until Kyle turns them back on.
  faults_off text[] not null default '{}' constraint outreach_state_faults_check check (faults_off <@ array['slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics']::text[]),
  updated_at timestamptz not null default now()
);

-- ---------- 4. prospects: businesses Draper has looked at, separate from leads ----------
create table if not exists public.outreach_prospects (
  id uuid primary key default gen_random_uuid(),
  business_name text,
  -- The bare host, lower case, no www. Stage 2 normalises it.
  domain text,
  website_url text,
  category text,
  services text[] not null default '{}',
  phone text,
  abn text check (abn ~ '^[0-9]{11}$'),
  abn_name text,
  abn_status text not null default 'unchecked' constraint outreach_prospects_abn_status_check check (abn_status in ('unchecked', 'active', 'cancelled', 'not_found')),
  -- 'abr' when Pulse checked it with the ABR web service, 'claude' when it is
  -- Claude's reading of the public ABN Lookup site (before the GUID is set).
  abn_checked_by text check (abn_checked_by in ('abr', 'claude')),
  abn_checked_at timestamptz,
  gst_registered boolean,
  suburb text,
  state text constraint outreach_prospects_state_check check (state in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')),
  postcode text check (postcode ~ '^[0-9]{4}$'),
  lane_id smallint references public.outreach_lanes(id),
  source text not null default 'claude_run' constraint outreach_prospects_source_check check (source in ('claude_run', 'manual')),
  status text not null default 'found' constraint outreach_prospects_status_check check (status in ('found', 'measured', 'dropped', 'queued', 'sent', 'followed_up', 'replied', 'later', 'closed')),
  drop_reason text,
  later_on date,
  -- Found while test mode was on. The end-to-end test's prospects can be
  -- cleared afterwards so real sending can still reach those businesses.
  test boolean not null default false,
  found_on date not null default ((now() at time zone 'Australia/Melbourne')::date),
  created_by text,
  -- Twelve months after a non-reply the details are blanked and only the
  -- fingerprint is kept. The row stays, anonymous, so the numbers still add up.
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (purged_at is not null or (business_name is not null and domain is not null)),
  check (status <> 'dropped' or drop_reason is not null),
  check (status <> 'later' or later_on is not null)
);
create unique index if not exists outreach_prospects_domain_idx
  on public.outreach_prospects (lower(domain)) where domain is not null;
create index if not exists outreach_prospects_status_idx on public.outreach_prospects (status);
create index if not exists outreach_prospects_lane_idx on public.outreach_prospects (lane_id, found_on);

-- ---------- 5. the address we write to, and where it was published ----------
create table if not exists public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null unique references public.outreach_prospects(id) on delete cascade,
  email text,
  email_lower text generated always as (lower(btrim(email))) stored,
  -- Only when a first name is published with that address.
  first_name text,
  address_kind text constraint outreach_contacts_kind_check check (address_kind in ('owner', 'general')),
  -- The page on their own site where it is published, the text around it,
  -- and the day it was seen there.
  source_url text,
  context text,
  seen_on date,
  -- Pulse re-fetched source_url and found the address on it.
  verified_at timestamptz,
  -- google, microsoft or other, from the domain's MX record.
  mx_provider text,
  bounced_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (purged_at is not null or (email is not null and source_url is not null and address_kind is not null))
);
create unique index if not exists outreach_contacts_email_idx
  on public.outreach_contacts (email_lower) where email_lower is not null;

-- ---------- 6. measurements: the proof ----------
create table if not exists public.outreach_measurements (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.outreach_prospects(id) on delete cascade,
  url text,
  final_url text,
  -- Why it ran: Claude's first look, Pulse's confirmation an hour or more
  -- later, the re-check before a send, the follow-up morning, or by hand.
  purpose text not null default 'initial' constraint outreach_measurements_purpose_check check (purpose in ('initial', 'confirm', 'pre_send', 'follow_up', 'manual')),
  -- 'blocked' is a bot-protection page: couldn't check, never a fault.
  status text not null default 'ok' constraint outreach_measurements_status_check check (status in ('ok', 'blocked', 'failed')),
  measured_at timestamptz not null default now(),
  psi_fcp_ms int check (psi_fcp_ms >= 0),
  psi_lcp_ms int check (psi_lcp_ms >= 0),
  -- PageSpeed's phone screenshot, in Storage.
  screenshot_path text,
  http_status int,
  https_status int,
  https_ok boolean,
  cert_valid boolean,
  -- [{ "url": ..., "label": ..., "status": 200 }]
  menu_links jsonb not null default '[]',
  -- { "aw": [...], "meta_pixel": [...], "ga4": [...], "ua": [...] }
  tags jsonb not null default '{}',
  -- { "<pixel id>": <PageView requests in one load> }
  pixel_pageviews jsonb not null default '{}',
  phone_in_html boolean,
  tel_link boolean,
  script_built boolean,
  ad_signal boolean,
  faults text[] not null default '{}' constraint outreach_measurements_faults_check check (faults <@ array['slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics']::text[]),
  error text,
  raw jsonb,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  check (purged_at is not null or url is not null)
);
create index if not exists outreach_measurements_prospect_idx
  on public.outreach_measurements (prospect_id, measured_at desc);

-- ---------- 7. messages: the first email and the one follow-up ----------
create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.outreach_prospects(id) on delete cascade,
  kind text not null constraint outreach_messages_kind_check check (kind in ('first', 'follow_up')),
  subject text,
  body text,
  -- The slot text Claude wrote, by slot name.
  slots jsonb not null default '{}',
  -- The fault this email is about.
  fault text constraint outreach_messages_fault_check check (fault in ('slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics')),
  template_version int not null references public.outreach_templates(version),
  -- The settings in force when it went.
  settings_version int references public.outreach_settings(version),
  -- Claude's own count of sentences true only of this business, and Pulse's
  -- count of claims backed by this business's own measurements or fields.
  personal_count int check (personal_count >= 0),
  personal_backed int check (personal_backed >= 0),
  status text not null default 'awaiting_confirmation' constraint outreach_messages_status_check check (status in ('awaiting_confirmation', 'queued', 'sending', 'sent', 'dropped', 'cancelled', 'expired', 'failed')),
  drop_reason text,
  -- Lanes with approval on hold the message until Kyle taps Approve.
  needs_approval boolean not null default false,
  approved_at timestamptz,
  -- From the 13th first email of a day: "Check these", sent after 12:30pm.
  past_twelve boolean not null default false,
  checked_at timestamptz,
  send_on date,
  scheduled_for timestamptz,
  queued_at timestamptz,
  sent_at timestamptz,
  -- The real address, or the test inbox it went to instead.
  sent_to text,
  test_mode boolean,
  gmail_message_id text,
  gmail_thread_id text,
  -- The Message-ID header, for the follow-up's In-Reply-To and References.
  rfc_message_id text,
  -- Kept on the message so the learning record outlives the purge.
  lane_id smallint references public.outreach_lanes(id),
  address_kind text,
  mx_provider text,
  purged_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One business, one approach: a first email and at most one follow-up.
  constraint outreach_messages_one_each unique (prospect_id, kind),
  check (purged_at is not null or (subject is not null and body is not null)),
  check (status <> 'sent' or sent_at is not null),
  check (status not in ('dropped', 'cancelled', 'expired', 'failed') or drop_reason is not null)
);
create index if not exists outreach_messages_queue_idx on public.outreach_messages (status, send_on);
create unique index if not exists outreach_messages_gmail_idx
  on public.outreach_messages (gmail_message_id) where gmail_message_id is not null;
create index if not exists outreach_messages_thread_idx
  on public.outreach_messages (gmail_thread_id) where gmail_thread_id is not null;

-- Each claim in a message, linked to the measurement behind it.
create table if not exists public.outreach_claims (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.outreach_messages(id) on delete cascade,
  measurement_id uuid not null references public.outreach_measurements(id),
  -- The confirming run, an hour or more after the first.
  confirmed_by uuid references public.outreach_measurements(id),
  -- Null for a claim that is not a fault: a page name, a suburb.
  fault text constraint outreach_claims_fault_check check (fault in ('slow_mobile', 'broken_page', 'not_secure', 'phone_not_tappable', 'pixel_double', 'old_analytics')),
  slot text not null constraint outreach_claims_slot_check check (slot in ('subject', 'finding', 'why_and_fix', 'second_finding')),
  quote text,
  created_at timestamptz not null default now()
);
create index if not exists outreach_claims_message_idx on public.outreach_claims (message_id);
create index if not exists outreach_claims_measurement_idx on public.outreach_claims (measurement_id);

-- ---------- 8. replies ----------
create table if not exists public.outreach_replies (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.outreach_prospects(id) on delete cascade,
  message_id uuid references public.outreach_messages(id) on delete set null,
  gmail_message_id text unique,
  received_at timestamptz not null,
  from_email text,
  kind text not null default 'reply' constraint outreach_replies_kind_check check (kind in ('reply', 'bounce', 'auto_reply', 'opt_out')),
  -- Their words, as written.
  quote text,
  -- Null until labelled: "needs label".
  label text constraint outreach_replies_label_check check (label in ('interested', 'question', 'later', 'sorted', 'no_thanks', 'wrong_fact', 'complaint', 'other')),
  later_on date,
  labelled_by text check (labelled_by in ('kyle', 'claude', 'pulse')),
  labelled_at timestamptz,
  lead_id uuid references public.leads(id) on delete set null,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  check (label is distinct from 'later' or later_on is not null)
);
create index if not exists outreach_replies_prospect_idx on public.outreach_replies (prospect_id, received_at);
create index if not exists outreach_replies_unlabelled_idx
  on public.outreach_replies (received_at) where label is null and kind = 'reply';

-- ---------- 9. events: everything that happened, with a time ----------
create table if not exists public.outreach_events (
  id bigint generated always as identity primary key,
  prospect_id uuid references public.outreach_prospects(id) on delete cascade,
  message_id uuid references public.outreach_messages(id) on delete cascade,
  kind text not null constraint outreach_events_kind_check check (kind in ('found', 'measured', 'dropped', 'submitted', 'refused', 'confirmed', 'queued', 'approved', 'checked', 'cancelled', 'expired', 'sent', 'followed_up', 'bounced', 'replied', 'labelled', 'opted_out', 'suppressed', 'lead_created', 'auto_paused', 'paused', 'resumed', 'fault_off', 'fault_on', 'purged')),
  actor text not null default 'pulse' check (actor in ('pulse', 'claude', 'kyle')),
  detail jsonb,
  at timestamptz not null default now()
);
create index if not exists outreach_events_prospect_idx on public.outreach_events (prospect_id, at);
create index if not exists outreach_events_kind_idx on public.outreach_events (kind, at);

-- ---------- 10. suppression fingerprints: forever ----------
-- SHA-256 of the normalised domain, ABN, business name, email and phone of
-- every business ever contacted or ever asking not to be. Stage 2 writes the
-- normalising. Never changed, never deleted.
create table if not exists public.outreach_fingerprints (
  id bigint generated always as identity primary key,
  kind text not null constraint outreach_fingerprints_kind_check check (kind in ('domain', 'abn', 'name', 'email', 'phone')),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  reason text not null constraint outreach_fingerprints_reason_check check (reason in ('contacted', 'opted_out', 'imported', 'do_not_contact')),
  -- Where it came from: a prospect id, or an import's file name.
  source text,
  created_at timestamptz not null default now(),
  unique (kind, hash)
);

-- ---------- 11. Kyle's private skip lists ----------
-- Businesses to skip. Claude only ever gets allowed or blocked from this.
create table if not exists public.outreach_exclusions (
  id uuid primary key default gen_random_uuid(),
  business_name text,
  domain text,
  abn text check (abn ~ '^[0-9]{11}$'),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  check (coalesce(business_name, domain, abn) is not null)
);
create index if not exists outreach_exclusions_domain_idx on public.outreach_exclusions (lower(domain));
create index if not exists outreach_exclusions_abn_idx on public.outreach_exclusions (abn);

-- Each current client's locations and services. A prospect offering an
-- overlapping service inside the radius is skipped.
create table if not exists public.outreach_client_areas (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  place text not null,
  postcode text check (postcode ~ '^[0-9]{4}$'),
  services text[] not null default '{}',
  radius_km numeric(5, 1) not null default 15 check (radius_km > 0 and radius_km <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outreach_client_areas_client_idx on public.outreach_client_areas (client_id);

-- ---------- 12. learning: the test register and the change log ----------
create table if not exists public.outreach_tests (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  version_a text not null,
  version_b text not null,
  started_on date,
  -- The count of first emails that ends it.
  ends_after int check (ends_after > 0),
  result text,
  status text not null default 'planned' constraint outreach_tests_status_check check (status in ('planned', 'live', 'ended')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live test at a time.
create unique index if not exists outreach_tests_one_live on public.outreach_tests ((true)) where status = 'live';

create table if not exists public.outreach_change_log (
  id bigint generated always as identity primary key,
  what text not null,
  why text,
  changed_by text,
  changed_at timestamptz not null default now()
);

-- ---------- 13. reference data, loaded by later stages ----------
-- Australian postcodes and their locations, for the client-area radius
-- (haversine). The loading stage records the dataset's source and licence.
create table if not exists public.outreach_postcodes (
  postcode text not null check (postcode ~ '^[0-9]{4}$'),
  locality text not null,
  state text not null check (state in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')),
  lat double precision not null,
  lon double precision not null,
  primary key (postcode, locality)
);

-- Public holidays, every state. Draper refuses to schedule a date this table
-- does not cover, so a missing year stops sending rather than sending on a
-- holiday.
create table if not exists public.outreach_holidays (
  on_date date not null,
  state text not null check (state in ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')),
  name text not null,
  primary key (on_date, state)
);

-- ---------- 14. the Gmail connection: service role only ----------
create table if not exists public.outreach_gmail (
  id boolean primary key default true check (id),
  email text not null,
  -- AES-GCM, base64 of iv + ciphertext + tag, under OUTREACH_TOKEN_KEY in Vercel.
  refresh_token_enc text not null,
  scopes text[] not null default '{}',
  connected_by text,
  connected_at timestamptz not null default now()
);

-- ---------- 15. triggers ----------
do $$
declare t text;
begin
  -- updated_at, as everywhere else.
  foreach t in array array[
    'outreach_lanes', 'outreach_state', 'outreach_prospects', 'outreach_contacts',
    'outreach_messages', 'outreach_client_areas', 'outreach_tests'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;

  -- Permanent records: added to, never changed, never removed, never truncated.
  foreach t in array array[
    'outreach_fingerprints', 'outreach_settings', 'outreach_templates',
    'outreach_run_instructions', 'outreach_lessons', 'outreach_change_log'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_keep', t);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.outreach_refuse_change()',
      t || '_keep', t);
    execute format('drop trigger if exists %I on public.%I', t || '_keep_all', t);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function public.outreach_refuse_change()',
      t || '_keep_all', t);
  end loop;
end $$;

drop trigger if exists outreach_messages_keep_sent on public.outreach_messages;
create trigger outreach_messages_keep_sent
  before delete on public.outreach_messages
  for each row execute function public.outreach_messages_keep_sent();

-- ---------- 16. row-level security: admins only ----------
do $$
declare
  t text;
  p record;
  -- Admins read, add, change and remove.
  full_access text[] := array[
    'outreach_lanes', 'outreach_prospects', 'outreach_contacts', 'outreach_measurements',
    'outreach_claims', 'outreach_replies', 'outreach_exclusions', 'outreach_client_areas',
    'outreach_tests'
  ];
  -- Admins read, add and change; nothing is removed.
  no_delete text[] := array['outreach_messages', 'outreach_state'];
  -- Admins read and add only.
  add_only text[] := array[
    'outreach_settings', 'outreach_templates', 'outreach_run_instructions', 'outreach_lessons',
    'outreach_events', 'outreach_change_log', 'outreach_fingerprints'
  ];
  -- Admins read only; loaded by migrations.
  read_only text[] := array['outreach_postcodes', 'outreach_holidays'];
begin
  foreach t in array full_access || no_delete || add_only || read_only || array['outreach_gmail'] loop
    execute format('alter table public.%I enable row level security', t);
    -- Supabase grants new tables to anon and authenticated by default,
    -- TRUNCATE included, which RLS does not cover. Start from nothing.
    execute format('revoke all on public.%I from anon, authenticated', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;

  foreach t in array full_access loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;

  foreach t in array no_delete loop
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_admin_add', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_change', t);
  end loop;

  foreach t in array add_only loop
    execute format('grant select, insert on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_admin_add', t);
  end loop;

  foreach t in array read_only loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
  end loop;

  -- outreach_gmail: RLS on, no grants, no policies. Service role only.
end $$;

-- ---------- 17. version 1 of everything, from Kyle's brief ----------
insert into public.outreach_templates (
  version, first_subject, first_body, followup_subject, followup_body,
  opt_out_a, opt_out_b, slot_rules, example, note, created_by
) values (
  1,
  'your {page_name} page',
  $t$Hi {first_name_or_there},

{finding}

{why_and_fix}

We run Google and Meta ads at Hartwell Digital. We noticed {other_things} while we were there, and we're happy to write {it_or_them} up and email {it_or_them} over if that's useful.

If this isn't relevant, just reply and say so, and we won't email again.

Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078$t$,
  'Re: {subject}',
  $t$Hi {first_name_or_there},

One last thing we noticed, in case it's useful. {second_finding}

The offer's still there if you'd like the rest written up.

{opt_out_line}

Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078$t$,
  $t$If this isn't relevant, just reply and say so, and we won't email again.$t$,
  $t$If it's not for you, one word back is a real help: "sorted" if someone already looks after your ads, "later" if the timing's off, or "no thanks" and we won't email again.$t$,
  $t$The wording is Kyle's. Claude fills only the slots; Pulse fills the rest.

{finding}: two sentences at most. What we looked at, the day, and the fault.
{why_and_fix}: two sentences at most. Why it matters to their customers, and the fix. It may mention the ad signal, as a likelihood ("probably"), never as a fact about their spend.
{second_finding}: one or two sentences. The second fault, re-measured that morning.

Each slot is 60 words or fewer.

Pulse fills these itself: {page_name}, {first_name_or_there} (their published first name, or "there"), {other_things} ("another thing" when one more fault is on record, "a couple of other things" when two or more), {it_or_them}, {opt_out_line} and {subject}.$t$,
  $t$Subject: your canopy page

Hi Sam,

We were looking at 4WD fit-out shops around the Sunshine Coast on Tuesday and had a look at your site. On a phone, your canopy page took a little over six seconds to show anything on Google's own speed test.

Your site has Google's ad tracking on it, so some of those visits are probably paid clicks. Plenty of people on a phone won't wait that long, so it'd be worth getting that page loading faster before putting more into ads.

(A made-up business.)$t$,
  'Version 1, from Kyle''s brief of 19 November 2026.',
  'migration 0062'
) on conflict (version) do nothing;

insert into public.outreach_run_instructions (version, body, note, created_by) values (
  1,
  $t$1. Call `outreach_brief`. Work only in the active lane. Stop when today's target is met, or after reading 8 sites for each email the target still needs (never more than 200 sites), whichever comes first.
2. Find businesses with web search: the lane's services plus each suburb. Skip anything in the lane's skip list or the "never" list, and any result that isn't the business's own site.
3. Check each one with `outreach_check_business`. If it's blocked, move on.
4. Read their own site.
   * Confirm they do the lane's work in the area.
   * Note their main services.
   * Find a published email on their own site. Never guess an address or build one from a pattern, and never take one from a directory or a finder tool. Skip the address if a "no marketing" or "no unsolicited email" note sits near it.
   * Prefer a named owner's address when one is published.
5. Check the ABN on the public ABN Lookup site (abr.business.gov.au). Use the ABN on their site, or their name plus state and postcode. Keep them only if the ABN is active and the match is certain.
6. Measure with `outreach_add_prospect`, then `outreach_measure` on the home page and the main service page. Keep them only if there's an ad signal and at least two faults. Otherwise call `outreach_drop` with the reason.
7. Write the slots using the template rules, then call `outreach_submit`. If it's refused, fix it once. If it's refused again, drop it.
8. Label replies: call `outreach_replies_to_label`, then `outreach_label_reply` for each.
9. Finish with a two-line summary: read, kept, submitted, dropped by reason.$t$,
  'Version 1, from Kyle''s brief of 19 November 2026.',
  'migration 0062'
) on conflict (version) do nothing;

insert into public.outreach_settings (version, never_list, note, created_by) values (
  1,
  array[
    'trades (electricians, plumbers, builders, landscapers and the like)',
    'cleaning businesses',
    'cyber security businesses',
    'franchises and national chains',
    'marketing agencies',
    'directories'
  ],
  'Version 1: master switch off, test mode on, 5 first emails a day.',
  'migration 0062'
) on conflict (version) do nothing;

insert into public.outreach_lanes (id, name, services, areas, skip, approval_required, active, notes) values
(
  1, '4WD, caravan and camper fit-outs',
  array[
    'canopy and drawer builders', 'ute trays', '12-volt and dual-battery fit-outs', 'suspension',
    'caravan and camper repairs', 'van and campervan conversions',
    'small camper trailer and off-road caravan builders'
  ],
  array[
    'Caloundra QLD', 'Kawana QLD', 'Kunda Park QLD', 'Maroochydore QLD', 'Nambour QLD', 'Noosaville QLD',
    'Campbellfield VIC', 'Thomastown VIC', 'Derrimut VIC', 'Laverton North VIC', 'Hoppers Crossing VIC',
    'Dandenong VIC', 'Carrum Downs VIC', 'Bayswater VIC'
  ],
  array[
    'national chains and their stores (for example TJM, ARB, Opposite Lock, Ironman 4x4)',
    'dealerships', 'national manufacturers'
  ],
  false, true, 'Active at launch.'
),
(
  2, 'Wedding and event hire',
  array['marquee and tent hire', 'furniture and styling hire', 'photo booths', 'dance floor and lighting hire', 'bridal boutiques'],
  array['Sunshine Coast and Noosa QLD', 'Melbourne VIC', 'Yarra Valley VIC', 'Mornington Peninsula VIC'],
  array['venues', 'hotels', 'party supply chains'],
  false, false, 'Next, from about February.'
),
(
  3, 'Wellness studios',
  array['reformer pilates and yoga studios', 'sauna and recovery studios', 'float centres', 'massage', 'martial arts and boxing gyms'],
  array['Sunshine Coast QLD', 'Melbourne VIC'],
  array[
    'anything caught by the client-area exclusions',
    'health practitioners registered with AHPRA (physio, chiro, psychology, dental and the like)',
    'medical or cosmetic treatments (IV therapy, injectables, cosmetic clinics)',
    'skin, beauty and facial clinics',
    'gym chains and studio franchises'
  ],
  false, false, null
),
(
  5, 'Reserves',
  array['horse float builders and repairers', 'swim spa and hot tub retailers'],
  '{}', '{}',
  false, false, 'Reserves, not active.'
)
on conflict (id) do nothing;

insert into public.outreach_state (id) values (true) on conflict (id) do nothing;

-- ---------- 18. labels for the Supabase table editor ----------
comment on table public.outreach_prospects is 'Draper: businesses looked at for outreach. Separate from leads.';
comment on table public.outreach_contacts is 'Draper: the published address written to, and the proof of where it was published.';
comment on table public.outreach_measurements is 'Draper: what Pulse measured on a prospect''s site. The proof behind every claim.';
comment on table public.outreach_messages is 'Draper: first emails and follow-ups. A real send is never deleted.';
comment on table public.outreach_claims is 'Draper: each claim in a message, linked to its measurement.';
comment on table public.outreach_replies is 'Draper: replies, bounces and opt-outs, with labels and their words.';
comment on table public.outreach_events is 'Draper: everything that happened, with a time.';
comment on table public.outreach_fingerprints is 'Draper: hashes of every business contacted or opted out. Never changed or deleted.';
comment on table public.outreach_exclusions is 'Draper: Kyle''s private list of businesses to skip.';
comment on table public.outreach_client_areas is 'Draper: current clients'' locations and services, kept clear of outreach.';
comment on table public.outreach_lanes is 'Draper: the niches, one active at a time. No defence lane (decision 8).';
comment on table public.outreach_settings is 'Draper: versioned settings. A change is a new row.';
comment on table public.outreach_templates is 'Draper: versioned email templates. A change is a new row.';
comment on table public.outreach_run_instructions is 'Draper: versioned instructions for the morning run.';
comment on table public.outreach_lessons is 'Draper: versioned lessons text, returned to the morning run.';
comment on table public.outreach_state is 'Draper: pause-all and the faults switched off. One row.';
comment on table public.outreach_tests is 'Draper: the test register. One live test at a time.';
comment on table public.outreach_change_log is 'Draper: what changed, when and why.';
comment on table public.outreach_postcodes is 'Draper: Australian postcodes with locations, for the client-area radius.';
comment on table public.outreach_holidays is 'Draper: public holidays by state. No row for a year means no sending that year.';
comment on table public.outreach_gmail is 'Draper: the encrypted Gmail connection. Service role only.';

notify pgrst, 'reload schema';
