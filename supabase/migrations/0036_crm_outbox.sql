-- =============================================================================
-- 0036 — send the outreach from the portal, through Kyle's Outlook mailbox
--
-- Sending moves out of Outlook by hand and into the portal, but NOT through
-- Resend. Resend sends as hartwelldigital.com, which carries the invoices and
-- the client notifications, and putting cold outreach on that domain would
-- risk the reputation of the mail that actually pays. Microsoft Graph sends
-- from kyle@ironpeakconsulting.com.au as an ordinary 1:1 message: real Sent
-- Items, real threading, no ESP headers, no tracking pixel, and no contact at
-- all with the Hartwell domain.
--
-- The important design decision here is the approval gate. A machine is about
-- to send cold email on Kyle's behalf at 8:47 in the morning while he is
-- asleep. Nothing sends that he has not read and approved, and approving is
-- where the nine pre-send checks are ticked, because the checks are worthless
-- if they happen at a moment nobody is present for.
--
-- Run after 0035. Idempotent.
-- =============================================================================

alter table public.crm_organisations
  -- The email itself, so the whole thing lives on the record.
  add column if not exists email_subject text,
  add column if not exists email_body text,
  -- Set only by a human reading the email. The sender refuses without it.
  add column if not exists send_approved_at timestamptz,
  add column if not exists send_approved_checks jsonb not null default '{}'::jsonb,
  -- Set by the sender. Last attempt, and what went wrong if anything did.
  add column if not exists send_attempted_at timestamptz,
  add column if not exists send_error text,
  add column if not exists graph_message_id text;

create index if not exists crm_org_outbox_idx
  on public.crm_organisations (brand, send_approved_at, scheduled_send_at)
  where send_approved_at is not null;

-- A real, working unsubscribe. Once a machine is doing the sending this stops
-- being a nicety: the Spam Act requires a functional opt-out on every
-- commercial electronic message, and "functional" means it has to do
-- something. Clicking this sets opt_out_at, which crm_touch_guard already
-- treats as an absolute block on every channel.
--
-- One token per contact, unguessable, and it identifies the contact on its own
-- so the link needs no other parameter and leaks nothing about anyone else.
alter table public.crm_contacts
  add column if not exists opt_out_token uuid not null default gen_random_uuid();

create unique index if not exists crm_contacts_opt_out_token_idx
  on public.crm_contacts (opt_out_token);

-- =============================================================================
-- Ask the guard whether a send would be allowed, without sending.
--
-- crm_touch_guard is the real gate: the two-email cap, the opt-out block, the
-- blocked and terminal stages, the nine checks. It fires on INSERT, which
-- means the natural order of events is send the email, then discover the
-- record was refused. That leaves an email in a prospect's inbox with no touch
-- row behind it, which is precisely the compliance gap the log exists to
-- prevent.
--
-- So the sender asks first. This inserts inside a sub-transaction, then throws
-- a sentinel to roll it back, so the guard runs in full against real data and
-- nothing survives. Any OTHER error is the guard's actual refusal and is
-- re-raised for the caller to read.
-- =============================================================================
create or replace function public.crm_dry_run_touch(
  p_contact_id uuid,
  p_checks jsonb
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.crm_touches (
      contact_id, organisation_id, channel, sequence_step, direction, presend_checks
    )
    -- organisation_id is overwritten by the BEFORE trigger from the contact;
    -- this placeholder only has to be non-null to reach it.
    values (p_contact_id, p_contact_id, 'email', 'email_1', 'out', p_checks);
    raise exception '__crm_dry_run_ok__';
  exception
    when others then
      if sqlerrm = '__crm_dry_run_ok__' then
        return;
      end if;
      raise;
  end;
end; $$;

revoke all on function public.crm_dry_run_touch(uuid, jsonb) from public;
grant execute on function public.crm_dry_run_touch(uuid, jsonb) to authenticated;

-- =============================================================================
-- Opting out is done by an anonymous visitor clicking a link in an email, so
-- it cannot go through the admin-only RLS the rest of the CRM uses. This
-- function is the single narrow hole: it takes a token, sets opt_out_at, and
-- returns nothing about the contact. A wrong token is indistinguishable from a
-- right one that was already actioned, so the endpoint cannot be used to test
-- whether an address is on the list.
-- =============================================================================
create or replace function public.crm_opt_out(token uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.crm_contacts
  set opt_out_at = coalesce(opt_out_at, now()),
      opt_out_channel = coalesce(opt_out_channel, 'email_link')
  where opt_out_token = token;

  -- Stop the company too, not just the person. One contact per company is the
  -- rule, so a person opting out ends the company.
  update public.crm_organisations o
  set stage = 'stopped'
  from public.crm_contacts c
  where c.opt_out_token = token
    and o.id = c.organisation_id
    and o.stage not in ('won', 'delivered');
end; $$;

revoke all on function public.crm_opt_out(uuid) from public;
grant execute on function public.crm_opt_out(uuid) to anon, authenticated;
