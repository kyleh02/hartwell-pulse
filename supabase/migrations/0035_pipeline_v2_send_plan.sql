-- =============================================================================
-- 0035 — the 7 August 2026 pipeline, and a send plan to work it day by day
--
-- The offer was repositioned from capability statements to websites. Every
-- record now leads with a specific verified fault on the company's own site,
-- the list is down to 30 from 76, and each queued record has a written email
-- with a planned send slot. What the CRM was missing is the shape of that
-- work: an order, a date, and somewhere to tick "drafted" and "sent".
--
-- Two states, not one, and deliberately so. Kyle drafts in Outlook ahead of
-- time and Outlook sends later. Collapsing those into one flag would either
-- claim an email went out when it is still sitting in a drafts folder, or lose
-- the work of having written it. The touch log still records the actual send:
-- that is what advances the stage, counts toward the daily goal and stands as
-- the Spam Act record. `scheduled_at` records only that it is queued to go.
--
-- Run after 0034. Idempotent.
-- =============================================================================

-- ---------- organisations ----------
alter table public.crm_organisations
  add column if not exists rank integer,
  -- The 1/2/3 conversion tier from the handoff. Distinct from the existing
  -- A/B/C/D `tier`, which grades research quality and means something else.
  add column if not exists priority_tier integer check (priority_tier between 1 and 3),
  add column if not exists channel text check (channel in ('DIDG', 'AIC')),
  -- When it is planned to go. Times are never on the hour or half hour, by
  -- Kyle's rule, so mail reads as hand-sent.
  add column if not exists scheduled_send_at timestamptz,
  -- When Kyle actually drafted or scheduled it in Outlook.
  add column if not exists scheduled_at timestamptz,
  add column if not exists followup_due date,
  add column if not exists hook text,
  add column if not exists hook_verified_at date,
  add column if not exists pipeline_notes text,
  -- A warning that must be shown and cannot be dismissed. PRP's founder died
  -- in November 2021; nothing may reference the founder or company history.
  add column if not exists hard_warning text;

create index if not exists crm_org_rank_idx on public.crm_organisations (brand, rank);
create index if not exists crm_org_schedule_idx
  on public.crm_organisations (brand, scheduled_send_at);

-- The handoff's status vocabulary. `queued`, `blocked` and `linkedin_only`
-- describe where a record sits before any contact, which the original stage
-- list had no way to say. The terminal three lock the record.
alter table public.crm_organisations
  drop constraint if exists crm_organisations_stage_check;
alter table public.crm_organisations
  add constraint crm_organisations_stage_check check (stage in (
    'researched', 'queued', 'blocked', 'linkedin_only', 'verified',
    'contacted', 'connected', 'followed_up', 'replied', 'conversation',
    'proposal', 'won', 'delivered',
    'lost', 'declined', 'bounced', 'stopped', 'do_not_contact'
  ));

-- ---------- contacts ----------
alter table public.crm_contacts
  -- own-site names are safe to greet by name. directory names have never been
  -- confirmed by the company and need ten seconds on LinkedIn first, or the
  -- fallback greeting.
  add column if not exists name_verified text
    check (name_verified in ('own-site', 'directory', 'unverified')),
  -- Where on their site the address appears, in words: "footer and contact
  -- page". NOT a URL, and deliberately not stored as one. Fabricating a URL
  -- would fake the single thing that has to be checkable, so the evidence is
  -- recorded as what was actually observed.
  add column if not exists email_source_note text,
  add column if not exists fallback_greeting text;

-- ---------- the send gate ----------
-- Rebuilt for two reasons.
--
-- First, a record that is blocked, linkedin-only or terminal must not be able
-- to log an outbound email at all. Tynbell is the live case: their website is
-- gone, so the publication that created the inferred-consent basis no longer
-- exists, and sending on a lapsed basis is the one real compliance exposure in
-- this pipeline. A rule that lives only in the UI is a rule that gets clicked
-- past at 11pm.
--
-- Second, the consent evidence may now be a source NOTE rather than a URL.
-- What the Spam Act needs is that the address was conspicuously published on
-- the company's own site, plus when that was checked. "footer and contact
-- page, verified 7 August 2026" is that evidence. A URL is a convenience for
-- re-checking it later, not the substance, and inventing one to satisfy a
-- NOT NULL would be worse than useless.
create or replace function public.crm_touch_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.crm_contacts%rowtype;
  org_brand text;
  org_stage text;
  org_name text;
  r_tech text;
  r_pos text;
  prior_emails integer;
  had_reply boolean;
  ticked integer;
begin
  select * into c from public.crm_contacts where id = new.contact_id;
  if c.id is null then
    raise exception 'Contact does not exist';
  end if;

  new.organisation_id := c.organisation_id;
  select brand, stage, legal_name into org_brand, org_stage, org_name
  from public.crm_organisations where id = c.organisation_id;

  if new.direction = 'out' then
    -- UNIVERSAL. Opted out is an absolute block, for every brand.
    if c.opt_out_at is not null then
      raise exception 'This contact opted out on %. No further outbound contact.',
        to_char(c.opt_out_at, 'DD Mon YYYY');
    end if;

    -- UNIVERSAL. Terminal states end all contact, on every channel.
    if org_stage in ('declined', 'bounced', 'stopped', 'do_not_contact') then
      raise exception '% is marked %. That is terminal: no further contact on any channel.',
        org_name, org_stage;
    end if;

    if new.channel = 'email' then
      if org_stage = 'blocked' then
        raise exception 'A blocked record cannot send. % is blocked because the address is no longer conspicuously published, so the inferred-consent basis has lapsed. Attach evidence of the address published today, then move it to queued.',
          org_name;
      end if;
      if org_stage = 'linkedin_only' then
        raise exception '% is LinkedIn only. No further email to this company.', org_name;
      end if;

      -- UNIVERSAL. The Spam Act applies to every commercial electronic message,
      -- so the consent evidence is required whichever brand is sending.
      if coalesce(c.email_as_published, '') = ''
         or (coalesce(c.email_source_url, '') = '' and coalesce(c.email_source_note, '') = '')
         or c.email_verified_at is null
         or c.consent_basis = 'none'
         or coalesce(c.relevance_note, '') = '' then
        raise exception 'Compliance fields incomplete: published address, where it appears, verified date, consent basis and relevance note are all required before logging an email.';
      end if;

      -- IRONPEAK ONLY from here down. These are playbook rules for the defence
      -- campaign, not legal requirements.
      if org_brand = 'ironpeak' then
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

        -- The gate on a FIRST email: a finding specific to their technical
        -- domain, plus a positive finding. A verified hook on the record now
        -- satisfies the technical half, because that is exactly what it is.
        if new.sequence_step = 'email_1' then
          select technical_domain_finding, positive_finding into r_tech, r_pos
          from public.crm_research where organisation_id = c.organisation_id;
          if coalesce(r_tech, '') = '' then
            select hook into r_tech from public.crm_organisations
            where id = c.organisation_id;
          end if;
          if coalesce(r_tech, '') = '' or coalesce(r_pos, '') = '' then
            raise exception 'The note is not ready: a first email needs a finding specific to their technical domain and at least one positive finding.';
          end if;
        end if;

        select count(*) into ticked
        from jsonb_each(new.presend_checks) as t(k, v)
        where v = 'true'::jsonb;
        if ticked < 9 then
          raise exception 'All nine pre-send checks must be ticked. % of 9 are.', ticked;
        end if;
      end if;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists crm_touches_guard on public.crm_touches;
create trigger crm_touches_guard before insert on public.crm_touches
  for each row execute function public.crm_touch_guard();
