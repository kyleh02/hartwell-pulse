-- =============================================================================
-- Hartwell Pulse — 0022 CRM (Ironpeak Consulting outreach)
-- Kyle-only sales CRM living inside the portal. Every table is admin-only:
-- clients must never see a prospect record, so RLS grants nothing but is_admin().
--
-- The point of difference from a generic contact list is the compliance trail.
-- Cold outreach relies on INFERRED consent under the Spam Act 2003, which only
-- attaches to an address the business itself conspicuously published. So the
-- exact published address, the URL it appeared on, and the date it was checked
-- are stored per contact and are REQUIRED before an outbound email can be
-- logged. The database enforces that, along with the opt-out block and the
-- two-email cap, because a rule that lives only in the UI is a rule that gets
-- clicked past at 11pm.
--
-- Deviation from the brief worth knowing: the brief lists both a status and a
-- pipeline stage on Organisation. Two overlapping state columns drift apart, so
-- this uses one `stage` covering the whole pipeline including the terminals.
-- Run after 0021. Idempotent.
-- =============================================================================

-- ---------- organisations ----------
create table if not exists public.crm_organisations (
  id uuid primary key default gen_random_uuid(),
  -- Ironpeak today; the column exists so Hartwell Digital prospects can share
  -- the CRM later without a retrofit.
  brand text not null default 'ironpeak',
  legal_name text not null,
  trading_name text,
  abn text,
  state text,
  website_url text,
  domain text,
  platform text not null default 'unknown'
    check (platform in ('wordpress', 'wix', 'squarespace', 'custom', 'unknown')),
  sector_tags text[] not null default '{}',
  employee_estimate integer,
  established_year integer,
  tier text check (tier in ('A', 'B', 'C', 'D')),
  research_file_path text,
  last_verified_at timestamptz,
  grant_total_aud numeric(14, 2) not null default 0,
  grant_count integer not null default 0,
  grant_streams text[] not null default '{}',
  new_capability boolean not null default false,
  headline_purpose text,
  stage text not null default 'researched'
    check (stage in (
      'researched', 'verified', 'contacted', 'connected', 'followed_up',
      'replied', 'conversation', 'proposal', 'won', 'delivered',
      'lost', 'do_not_contact'
    )),
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_org_stage_idx on public.crm_organisations (stage);
create index if not exists crm_org_tier_idx on public.crm_organisations (tier);
create unique index if not exists crm_org_name_brand_idx
  on public.crm_organisations (brand, lower(legal_name));

-- ---------- grants (a company can hold more than one) ----------
create table if not exists public.crm_grants (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references public.crm_organisations(id) on delete cascade,
  amount numeric(14, 2) not null default 0,
  stream text,
  -- The public sentence describing what they were funded to build. This is the
  -- most useful field for outreach: it makes an approach specific.
  purpose text,
  created_at timestamptz not null default now()
);
create index if not exists crm_grants_org_idx on public.crm_grants (organisation_id);

-- ---------- contacts ----------
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references public.crm_organisations(id) on delete cascade,
  first_name text,
  surname text,
  role_title text,
  role_source text check (role_source in ('own_site', 'trade_press', 'linkedin', 'referral')),
  role_verified_at timestamptz,
  -- Stored VERBATIM. Never trimmed, lowercased or canonicalised: the exact
  -- string as published is the evidence.
  email_as_published text,
  email_source_url text,
  email_verified_at timestamptz,
  screenshot_path text,
  linkedin_url text,
  consent_basis text not null default 'none'
    check (consent_basis in ('inferred_published', 'express', 'referral', 'none')),
  relevance_note text,
  is_sole_contact_for_org boolean not null default true,
  opt_out_at timestamptz,
  opt_out_actioned_at timestamptz,
  opt_out_channel text,
  opt_out_verbatim text,
  created_at timestamptz not null default now()
);
-- One contact per organisation, ever. A warm internal referral the company
-- itself hands over is the only exception, and it carries the flag false.
create unique index if not exists crm_contacts_one_per_org
  on public.crm_contacts (organisation_id)
  where is_sole_contact_for_org;
create index if not exists crm_contacts_org_idx on public.crm_contacts (organisation_id);

-- ---------- touches ----------
create table if not exists public.crm_touches (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  organisation_id uuid not null
    references public.crm_organisations(id) on delete cascade,
  channel text not null
    check (channel in ('email', 'linkedin_note', 'linkedin_message', 'reply', 'meeting')),
  sequence_step text not null default 'ad_hoc'
    check (sequence_step in ('email_1', 'linkedin_connect', 'email_2', 'ad_hoc', 'inbound')),
  direction text not null check (direction in ('out', 'in')),
  sent_at timestamptz not null default now(),
  subject text,
  -- What was ACTUALLY sent, not the template. If a complaint arrives, this is
  -- the defence.
  body_snapshot text,
  outcome text not null default 'none'
    check (outcome in ('none', 'reply_positive', 'reply_neutral', 'reply_negative', 'bounce', 'opt_out')),
  substantive boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists crm_touches_contact_idx on public.crm_touches (contact_id, sent_at);
create index if not exists crm_touches_sent_idx on public.crm_touches (sent_at);

-- ---------- opportunities and engagements ----------
create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references public.crm_organisations(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  service_lines text[] not null default '{}',
  stage text not null default 'conversation',
  value_estimate_aud numeric(14, 2),
  probability integer check (probability between 0 and 100),
  expected_close date,
  source text,
  lost_reason text,
  created_at timestamptz not null default now()
);
create index if not exists crm_opps_org_idx on public.crm_opportunities (organisation_id);

create table if not exists public.crm_engagements (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  organisation_id uuid not null
    references public.crm_organisations(id) on delete cascade,
  service_line text,
  scope_summary text,
  start_date date,
  content_freeze_date date,
  delivery_date date,
  status text not null default 'scoped'
    check (status in ('scoped', 'in_progress', 'content_freeze', 'delivered', 'closed')),
  -- Set at close; drives the recurring annual review reminder.
  annual_review_month integer check (annual_review_month between 1 and 12),
  created_at timestamptz not null default now()
);
create index if not exists crm_engagements_status_idx on public.crm_engagements (status);

-- ---------- tasks (follow-up reminders) ----------
create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.crm_organisations(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  kind text not null default 'follow_up'
    check (kind in ('follow_up', 'linkedin_connect', 'reverify', 'annual_review', 'manual')),
  title text not null,
  due_on date not null,
  done_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists crm_tasks_due_idx on public.crm_tasks (due_on) where done_at is null;

-- ---------- notes ----------
create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references public.crm_organisations(id) on delete cascade,
  body text not null,
  author_user_id text,
  created_at timestamptz not null default now()
);
create index if not exists crm_notes_org_idx on public.crm_notes (organisation_id, created_at);

-- ---------- settings (single row) ----------
create table if not exists public.crm_settings (
  id boolean primary key default true check (id),
  daily_contact_goal integer not null default 3,
  weekly_contact_goal integer not null default 3,
  -- Two live engagements is the brake: three yeses in a fortnight breaks a
  -- one-person business.
  capacity_engagement_limit integer not null default 2,
  -- At this many sends with no substantive reply, stop and rethink the offer.
  abort_warning_sends integer not null default 15,
  reverify_after_days integer not null default 14,
  updated_at timestamptz not null default now()
);
insert into public.crm_settings (id) values (true) on conflict (id) do nothing;

-- =============================================================================
-- RLS: admin only, on every table. Clients can never read a prospect.
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'crm_organisations', 'crm_grants', 'crm_contacts', 'crm_touches',
    'crm_opportunities', 'crm_engagements', 'crm_tasks', 'crm_notes',
    'crm_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

-- =============================================================================
-- Hard rules. These live in the database because a rule enforced only in the
-- UI is a rule that gets clicked past.
-- =============================================================================

create or replace function public.crm_touch_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.crm_contacts%rowtype;
  r public.crm_research%rowtype;
  prior_emails integer;
  had_reply boolean;
  ticked integer;
begin
  select * into c from public.crm_contacts where id = new.contact_id;
  if c.id is null then
    raise exception 'Contact does not exist';
  end if;

  -- Keep the denormalised organisation honest.
  new.organisation_id := c.organisation_id;

  if new.direction = 'out' then
    -- 1. Opted out is an absolute block, not a warning.
    if c.opt_out_at is not null then
      raise exception 'This contact opted out on %. No further outbound contact.',
        to_char(c.opt_out_at, 'DD Mon YYYY');
    end if;

    -- 2. Cold outreach needs its consent evidence complete before it goes out.
    if new.channel = 'email' then
      if coalesce(c.email_as_published, '') = ''
         or coalesce(c.email_source_url, '') = ''
         or c.email_verified_at is null
         or c.consent_basis = 'none'
         or coalesce(c.relevance_note, '') = '' then
        raise exception 'Compliance fields incomplete: published address, source URL, verified date, consent basis and relevance note are all required before logging an email.';
      end if;

      -- 3. Two emails and the sequence closes. Once they have replied it is a
      --    conversation rather than cold outreach, so the cap lifts.
      select count(*) into prior_emails
      from public.crm_touches
      where contact_id = new.contact_id and direction = 'out' and channel = 'email';
      select exists (
        select 1 from public.crm_touches
        where contact_id = new.contact_id and direction = 'in'
      ) into had_reply;
      if prior_emails >= 2 and not had_reply then
        raise exception 'Two emails already sent and no reply. The sequence is closed for this contact.';
      end if;

      -- 4. The gate. A first email needs a finding specific to their TECHNICAL
      --    domain, not their marketing, plus a specific positive finding. If
      --    the note has neither, it is not ready and must not go.
      if new.sequence_step = 'email_1' then
        select * into r from public.crm_research where organisation_id = c.organisation_id;
        if r.id is null
           or coalesce(r.technical_domain_finding, '') = ''
           or coalesce(r.positive_finding, '') = '' then
          raise exception 'The note is not ready: a first email needs a finding specific to their technical domain and at least one positive finding.';
        end if;
      end if;

      -- 5. The nine pre-send checks, counted on this send. Held per touch, so
      --    they are a real check every time rather than ticked once and reused.
      if new.sequence_step in ('email_1', 'email_2') then
        select count(*) into ticked
        from jsonb_each(new.presend_checks) where value = 'true'::jsonb;
        if coalesce(ticked, 0) < 9 then
          raise exception 'Pre-send checklist incomplete: % of 9 ticked.', coalesce(ticked, 0);
        end if;
      end if;
    end if;
  end if;

  return new;
end $$;
drop trigger if exists crm_touch_guard_trg on public.crm_touches;
create trigger crm_touch_guard_trg
  before insert on public.crm_touches
  for each row execute function public.crm_touch_guard();

-- A negative reply, bounce or opt-out stops everything, permanently.
create or replace function public.crm_touch_after()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.outcome in ('reply_negative', 'bounce', 'opt_out') then
    update public.crm_organisations
    set stage = 'do_not_contact', updated_at = now()
    where id = new.organisation_id;
    if new.outcome = 'opt_out' then
      update public.crm_contacts
      set opt_out_at = coalesce(opt_out_at, now()),
          opt_out_channel = coalesce(opt_out_channel, new.channel)
      where id = new.contact_id;
    end if;
    -- Nothing left to chase.
    update public.crm_tasks
    set done_at = now()
    where contact_id = new.contact_id and done_at is null;
  end if;
  return new;
end $$;
drop trigger if exists crm_touch_after_trg on public.crm_touches;
create trigger crm_touch_after_trg
  after insert on public.crm_touches
  for each row execute function public.crm_touch_after();

-- =============================================================================
-- Research: "the note". The seven questions Kyle answers from public material
-- only, plus the findings that decide whether an email may be sent at all.
--
-- Two of these are gates, not notes. The playbook is explicit: if there is no
-- finding specific to their TECHNICAL domain (as opposed to their marketing),
-- do not send; and every note must carry at least one specific positive
-- finding with the reason it is good. Both are enforced below.
-- =============================================================================
create table if not exists public.crm_research (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique
    references public.crm_organisations(id) on delete cascade,
  verified_on date,
  -- The observation that opens the email, and how it was checked. Method
  -- matters: naive keyword searching produced false positives on both
  -- companies researched so far (matching "disp" inside "display" in a Wix
  -- bundle being the worst), so recording the method stops a repeat.
  lead_finding text,
  lead_finding_method text,
  technical_domain_finding text,
  positive_finding text,
  keep_out_of_first_email text,
  blocker text,
  -- [{ n, question, visibility: visible|partly_visible|not_findable, answer }]
  seven_questions jsonb not null default '[]'::jsonb,
  -- Free key/value observations: platform, page weight, copyright year, etc.
  signals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_research enable row level security;
grant select, insert, update, delete on public.crm_research to authenticated;
drop policy if exists crm_research_admin_all on public.crm_research;
create policy crm_research_admin_all on public.crm_research
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Contact fields the qualification filter needs beyond the consent trail.
alter table public.crm_contacts
  add column if not exists role_confirmed boolean not null default false,
  add column if not exists no_opt_out_notice boolean not null default false;

-- The nine pre-send checks, captured per send rather than as a global
-- checklist. The old tracker stored these once and reused them, which meant
-- they stopped being a real check after the first email.
alter table public.crm_touches
  add column if not exists presend_checks jsonb not null default '{}'::jsonb;

-- Keep updated_at honest using the helper from 0001.
drop trigger if exists crm_org_set_updated_at on public.crm_organisations;
create trigger crm_org_set_updated_at before update on public.crm_organisations
  for each row execute function public.set_updated_at();
drop trigger if exists crm_research_set_updated_at on public.crm_research;
create trigger crm_research_set_updated_at before update on public.crm_research
  for each row execute function public.set_updated_at();

-- CRM reminders are notifications addressed to Kyle, with no client attached.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'message', 'report_ready', 'asset_feedback', 'asset_uploaded',
    'status_change', 'invoice', 'crm_reminder'
  ));

-- =============================================================================
-- Dashboard metrics. Opt-outs first: it is the health metric, not reply rate.
-- =============================================================================
create or replace function public.crm_metrics(p_days integer default 7)
returns table (
  sent bigint,
  replies bigint,
  substantive bigint,
  opt_outs bigint,
  sent_today bigint,
  live_engagements bigint,
  sends_since_substantive bigint
)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.crm_touches
      where direction = 'out' and channel = 'email'
        and sent_at >= now() - make_interval(days => p_days)),
    (select count(*) from public.crm_touches
      where direction = 'in' and sent_at >= now() - make_interval(days => p_days)),
    (select count(*) from public.crm_touches
      where direction = 'in' and substantive
        and sent_at >= now() - make_interval(days => p_days)),
    (select count(*) from public.crm_touches where outcome = 'opt_out'),
    (select count(*) from public.crm_touches
      where direction = 'out' and channel = 'email'
        and sent_at >= date_trunc('day', now() at time zone 'Australia/Brisbane')
                       at time zone 'Australia/Brisbane'),
    (select count(*) from public.crm_engagements
      where status in ('scoped', 'in_progress', 'content_freeze')),
    (select count(*) from public.crm_touches
      where direction = 'out' and channel = 'email'
        and sent_at > coalesce(
          (select max(sent_at) from public.crm_touches where direction = 'in' and substantive),
          '-infinity'::timestamptz));
$$;
grant execute on function public.crm_metrics(integer) to authenticated;
