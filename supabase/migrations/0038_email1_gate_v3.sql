-- Point the first-email gate at what version 3 actually requires.
--
-- The gate demanded a `technical_domain_finding` and a `positive_finding` on
-- crm_research before any first email. That came from the original brief, when
-- the offer was capability statements and the message shape was "here is
-- something good about you, and here is a gap". The 7 August repositioning
-- replaced that shape entirely: one specific checkable fault on their own
-- website, a second smaller observation, a generic offer, 110 to 135 words.
-- Version 3's Part D no longer mentions findings at all.
--
-- So the gate was refusing correct emails for failing a rule that no longer
-- exists, and crm_research holds no rows for these companies in any case.
--
-- This is NOT the gate being loosened. It is being pointed at the thing that
-- now carries the risk. Every record holds a `hook`, the one verified fault the
-- email leads with, and a `hook_verified_at`. Version 3's rule 21 says a fault
-- older than 14 days may not be quoted without re-verification, and rule 23,
-- added after the Coastal Aviation near-miss, says any claim about what a
-- visitor can see must be checked in a rendering browser. A dated hook is a
-- stronger, more checkable gate than a free-text note ever was.
--
-- Everything else is untouched: the opt-out block, blocked and terminal
-- stages, the two-email cap, and the nine pre-send checks.
--
-- Run after 0037. Idempotent.

create or replace function public.crm_touch_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.crm_contacts%rowtype;
  org_brand text;
  org_stage text;
  org_name text;
  org_hook text;
  org_hook_at date;
  prior_emails integer;
  had_reply boolean;
  ticked integer;
begin
  select * into c from public.crm_contacts where id = new.contact_id;
  if c.id is null then
    raise exception 'Contact does not exist';
  end if;

  new.organisation_id := c.organisation_id;
  select brand, stage, legal_name, hook, hook_verified_at
    into org_brand, org_stage, org_name, org_hook, org_hook_at
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

      -- UNIVERSAL. The Spam Act applies to every commercial electronic message.
      if coalesce(c.email_as_published, '') = ''
         or (coalesce(c.email_source_url, '') = '' and coalesce(c.email_source_note, '') = '')
         or c.email_verified_at is null
         or c.consent_basis = 'none'
         or coalesce(c.relevance_note, '') = '' then
        raise exception 'Compliance fields incomplete: published address, where it appears, verified date, consent basis and relevance note are all required before logging an email.';
      end if;

      -- IRONPEAK ONLY. Playbook rules for the defence campaign, not law.
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

        -- A first email leads with a verified fault on their own site, and the
        -- verification has to be recent. Websites change, and the entire offer
        -- rests on the fault being real today rather than a fortnight ago.
        if new.sequence_step = 'email_1' then
          if coalesce(org_hook, '') = '' then
            raise exception 'No verified fault recorded for %. A first email leads with one.',
              org_name;
          end if;
          if org_hook_at is null then
            raise exception 'The fault for % has no verification date. Re-check it against the live site and record the date.',
              org_name;
          end if;
          if org_hook_at < current_date - interval '14 days' then
            raise exception 'The fault for % was last verified on %, more than 14 days ago. Re-check it against the live site before quoting it.',
              org_name, to_char(org_hook_at, 'DD Mon YYYY');
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
