-- =============================================================================
-- 0056 — a fresh, simple sales pipeline; the old CRM deleted
--
-- On 28 October 2026 Kyle chose to delete the old pipeline (the Ironpeak
-- outreach CRM, never really used for his own leads) permanently, KEEPING the
-- opt-out list. This migration does both, in that order, inside one
-- transaction: the do-not-contact list is filled from the old data first, so
-- nobody who opted out, declined or was marked do-not-contact can ever be
-- contacted again, and only then is the old data dropped.
--
-- THIS DELETES DATA FOR GOOD: every crm_* table, including the send log
-- (crm_touches) that was the Spam Act record of what was sent. Kyle was told
-- that and chose deletion. Nothing here touches invoices, reports or clients.
--
-- Then the new pipeline: leads, an activity log, and scheduled emails for the
-- welcome sequence a won lead starts.
--
-- Run after 0055. Safe to run twice: once the crm_* tables are gone the copy
-- is skipped.
-- =============================================================================

-- ---------- 1. the do-not-contact list, filled before anything is dropped ----------
create table if not exists public.do_not_contact (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_lower text generated always as (lower(btrim(email))) stored,
  name text,
  business text,
  website text,
  reason text not null,
  source text,
  recorded_at timestamptz not null default now()
);
create unique index if not exists do_not_contact_email_idx
  on public.do_not_contact (email_lower) where email_lower is not null;

alter table public.do_not_contact enable row level security;
revoke all on public.do_not_contact from anon;
grant select, insert, update, delete on public.do_not_contact to authenticated;
drop policy if exists do_not_contact_admin_all on public.do_not_contact;
create policy do_not_contact_admin_all on public.do_not_contact
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

do $$
begin
  if to_regclass('public.crm_contacts') is not null and to_regclass('public.crm_organisations') is not null then
    -- People who opted out, and the contact at any company that declined or
    -- was marked do-not-contact.
    insert into public.do_not_contact (email, name, business, website, reason, source, recorded_at)
    select
      c.email_as_published,
      nullif(btrim(concat_ws(' ', c.first_name, c.surname)), ''),
      coalesce(o.trading_name, o.legal_name),
      coalesce(o.website_url, o.domain),
      case
        when c.opt_out_at is not null then 'Opted out'
        when o.stage = 'declined' then 'Declined'
        else 'Not to be contacted'
      end,
      'Ironpeak outreach, 2026',
      coalesce(c.opt_out_at, o.updated_at, now())
    from public.crm_contacts c
    join public.crm_organisations o on o.id = c.organisation_id
    where c.opt_out_at is not null
       or o.stage in ('do_not_contact', 'declined', 'stopped')
    on conflict do nothing;

    -- A company in one of those stages with no contact email on file still
    -- goes on the list, by name and website.
    insert into public.do_not_contact (name, business, website, reason, source, recorded_at)
    select null, coalesce(o.trading_name, o.legal_name), coalesce(o.website_url, o.domain),
      case when o.stage = 'declined' then 'Declined' else 'Not to be contacted' end,
      'Ironpeak outreach, 2026', coalesce(o.updated_at, now())
    from public.crm_organisations o
    where o.stage in ('do_not_contact', 'declined', 'stopped')
      and not exists (
        select 1 from public.crm_contacts c
        where c.organisation_id = o.id and c.email_as_published is not null
      );
  end if;
end $$;

-- ---------- 2. the old CRM, gone ----------
-- Every function and table named crm_*, found rather than listed, so nothing
-- added by a later migration is missed.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'crm\_%'
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
  for r in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'crm\_%'
  loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
end $$;

-- Outreach work left open on the dashboard points at nothing now.
update public.work_items
set state = 'dropped', dropped_at = now(), drop_reason = 'Old pipeline cleared'
where state = 'open' and source_kind in ('crm_send', 'crm_task');

-- Follow-ups on the new pipeline become dashboard work too.
alter table public.work_items drop constraint if exists work_items_source_kind_check;
alter table public.work_items add constraint work_items_source_kind_check
  check (source_kind in (
    'manual', 'crm_send', 'crm_task', 'invoice', 'report',
    'recurring', 'notification', 'lead'
  ));

-- ---------- 3. the new pipeline ----------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  business text,
  email text,
  phone text,
  website text,
  source text not null default 'manual'
    check (source in ('website', 'quiz', 'audit', 'referral', 'manual', 'other')),
  -- What they are after, in their words or Kyle's.
  service text,
  -- What the work is worth, roughly, in dollars.
  value numeric(12, 2),
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'meeting', 'proposal', 'won', 'lost')),
  next_action text,
  follow_up_on date,
  notes text,
  lost_reason text,
  client_id uuid references public.clients(id) on delete set null,
  stage_changed_at timestamptz not null default now(),
  won_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_stage_idx on public.leads (stage, follow_up_on);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create table if not exists public.lead_activity (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('created', 'note', 'call', 'email', 'meeting', 'stage', 'won', 'lost')),
  body text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists lead_activity_lead_idx on public.lead_activity (lead_id, created_at);

-- ---------- 4. emails to send later: the welcome sequence ----------
create table if not exists public.scheduled_emails (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  recipient_user_id text,
  to_email text not null,
  kind text not null,
  send_after timestamptz not null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, kind, to_email)
);
create index if not exists scheduled_emails_due_idx
  on public.scheduled_emails (send_after) where sent_at is null and cancelled_at is null;

do $$
declare t text;
begin
  foreach t in array array['leads', 'lead_activity', 'scheduled_emails']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
