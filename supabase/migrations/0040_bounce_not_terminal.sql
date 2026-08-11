-- Change 8: a bounce is not a refusal, and it must not spend a touch.
--
-- Rule 4 made `bounced` terminal alongside `declined` and `stopped`, which was
-- right when a bounce meant a dead address. It is wrong here. Four companies
-- bounced because of a sending-side fault at Kyle's end; nobody at any of them
-- saw a message, and nobody refused anything. Treating that as a decline would
-- retire four live prospects over a problem they had no part in.
--
-- Two consequences, both fixed here.
--
-- FIRST, `bounced` stops being terminal. Contact may continue.
--
-- SECOND, and easier to miss: the two-email cap counts touches regardless of
-- outcome, so each of those four had already spent one of its two emails on a
-- message nobody read. Bounced touches are now excluded from the count, which
-- restores all four to two remaining. The touch itself stays, because it is
-- still a true record of an attempt, and deleting evidence to fix arithmetic
-- would be the wrong trade.
--
-- A new terminal-ish status arrives with it: `email_closed`. Coastal Aviation
-- is the case. Their mail server will not accept anything from this sender, so
-- email is not viable, but LinkedIn and the telephone are open and Robert has
-- never seen the message. Terminal states end every channel; this one ends one.
--
-- Run after 0039. Idempotent.

alter table public.crm_organisations
  drop constraint if exists crm_organisations_stage_check;
alter table public.crm_organisations
  add constraint crm_organisations_stage_check check (stage in (
    'researched', 'queued', 'blocked', 'linkedin_only', 'email_closed',
    'verified', 'contacted', 'connected', 'followed_up', 'replied',
    'conversation', 'proposal', 'won', 'delivered',
    'lost', 'declined', 'bounced', 'stopped', 'do_not_contact'
  ));

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
    if c.opt_out_at is not null then
      raise exception 'This contact opted out on %. No further outbound contact.',
        to_char(c.opt_out_at, 'DD Mon YYYY');
    end if;

    -- Terminal states end contact on every channel. `bounced` is deliberately
    -- NOT among them any more: a bounce means the message never arrived, which
    -- is the opposite of a refusal.
    if org_stage in ('declined', 'stopped', 'do_not_contact') then
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
      -- Email only. LinkedIn and the telephone remain open, which is the whole
      -- reason this status exists separately from the terminal ones.
      if org_stage = 'email_closed' then
        raise exception 'Email to % is closed: their mail server refuses messages from this sender. Reach them by LinkedIn or telephone instead.',
          org_name;
      end if;

      if coalesce(c.email_as_published, '') = ''
         or (coalesce(c.email_source_url, '') = '' and coalesce(c.email_source_note, '') = '')
         or c.email_verified_at is null
         or c.consent_basis = 'none'
         or coalesce(c.relevance_note, '') = '' then
        raise exception 'Compliance fields incomplete: published address, where it appears, verified date, consent basis and relevance note are all required before logging an email.';
      end if;

      if org_brand = 'ironpeak' then
        -- Bounced sends do not count. The cap exists to stop a prospect being
        -- pestered, and a message that never arrived has pestered nobody.
        select count(*) into prior_emails
        from public.crm_touches
        where contact_id = new.contact_id
          and direction = 'out'
          and channel = 'email'
          and outcome is distinct from 'bounce';
        select exists (
          select 1 from public.crm_touches
          where contact_id = new.contact_id and direction = 'in'
        ) into had_reply;
        if prior_emails >= 2 and not had_reply then
          raise exception 'Two emails already sent and no reply. The sequence is closed for this contact.';
        end if;

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
