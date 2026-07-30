-- =============================================================================
-- Hartwell Pulse - 0025 CRM: two brands, two rule sets
--
-- The CRM now runs a pipeline per trading brand. The tables already carried a
-- brand column, so this migration is mostly about the RULES, which is the part
-- that actually matters.
--
-- The Ironpeak gates come from its defence outreach playbook: two emails then
-- the sequence closes, a first email needs a finding specific to the
-- prospect's technical domain plus a positive finding, and all nine pre-send
-- checks ticked. Those are campaign strategy for a sector where one forwarded
-- complaint costs more than the campaign returns. They are NOT law, and
-- forcing them onto Hartwell Digital's very different client base would make
-- the CRM unusable for it.
--
-- What stays universal, for every brand, because it IS law: the Spam Act 2003
-- applies to every commercial electronic message sent in Australia. So the
-- opt-out block and the consent trail (published address, source URL, verified
-- date, consent basis, relevance note) are still required before any outbound
-- email can be logged, whichever brand it belongs to.
-- Run after 0024. Idempotent.
-- =============================================================================

create or replace function public.crm_touch_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.crm_contacts%rowtype;
  org_brand text;
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
  select brand into org_brand from public.crm_organisations where id = c.organisation_id;

  if new.direction = 'out' then
    -- UNIVERSAL. Opted out is an absolute block, for every brand.
    if c.opt_out_at is not null then
      raise exception 'This contact opted out on %. No further outbound contact.',
        to_char(c.opt_out_at, 'DD Mon YYYY');
    end if;

    if new.channel = 'email' then
      -- UNIVERSAL. The Spam Act applies to every commercial electronic message,
      -- so the consent evidence is required whichever brand is sending.
      if coalesce(c.email_as_published, '') = ''
         or coalesce(c.email_source_url, '') = ''
         or c.email_verified_at is null
         or c.consent_basis = 'none'
         or coalesce(c.relevance_note, '') = '' then
        raise exception 'Compliance fields incomplete: published address, source URL, verified date, consent basis and relevance note are all required before logging an email.';
      end if;

      -- IRONPEAK ONLY from here down. These are playbook rules for the defence
      -- campaign, not legal requirements.
      if org_brand = 'ironpeak' then
        -- Two emails and the sequence closes, unless they have replied, at
        -- which point it is a conversation rather than cold outreach.
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

        -- The gate: a first email needs a finding specific to their technical
        -- domain, not their marketing, plus a specific positive finding.
        if new.sequence_step = 'email_1' then
          select technical_domain_finding, positive_finding into r_tech, r_pos
          from public.crm_research where organisation_id = c.organisation_id;
          if coalesce(r_tech, '') = '' or coalesce(r_pos, '') = '' then
            raise exception 'The note is not ready: a first email needs a finding specific to their technical domain and at least one positive finding.';
          end if;
        end if;

        -- The nine pre-send checks, counted on this send.
        if new.sequence_step in ('email_1', 'email_2') then
          select count(*) into ticked
          from jsonb_each(new.presend_checks) where value = 'true'::jsonb;
          if coalesce(ticked, 0) < 9 then
            raise exception 'Pre-send checklist incomplete: % of 9 ticked.', coalesce(ticked, 0);
          end if;
        end if;
      end if;
    end if;
  end if;

  return new;
end $$;

-- ---------- metrics, per brand ----------
-- Two campaigns against two different client bases produce two different reply
-- rates. Averaging them into one dashboard number would hide both.
drop function if exists public.crm_metrics(integer);
create or replace function public.crm_metrics(
  p_days integer default 7,
  p_brand text default null
)
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
  with scoped as (
    select t.*
    from public.crm_touches t
    join public.crm_organisations o on o.id = t.organisation_id
    where p_brand is null or o.brand = p_brand
  )
  select
    (select count(*) from scoped
      where direction = 'out' and channel = 'email'
        and sent_at >= now() - make_interval(days => p_days)),
    (select count(*) from scoped
      where direction = 'in' and sent_at >= now() - make_interval(days => p_days)),
    (select count(*) from scoped
      where direction = 'in' and substantive
        and sent_at >= now() - make_interval(days => p_days)),
    (select count(*) from scoped where outcome = 'opt_out'),
    (select count(*) from scoped
      where direction = 'out' and channel = 'email'
        and sent_at >= date_trunc('day', now() at time zone 'Australia/Brisbane')
                       at time zone 'Australia/Brisbane'),
    (select count(*) from public.crm_engagements e
      join public.crm_organisations o on o.id = e.organisation_id
      where e.status in ('scoped', 'in_progress', 'content_freeze')
        and (p_brand is null or o.brand = p_brand)),
    (select count(*) from scoped
      where direction = 'out' and channel = 'email'
        and sent_at > coalesce(
          (select max(sent_at) from scoped where direction = 'in' and substantive),
          '-infinity'::timestamptz));
$$;
grant execute on function public.crm_metrics(integer, text) to authenticated;
