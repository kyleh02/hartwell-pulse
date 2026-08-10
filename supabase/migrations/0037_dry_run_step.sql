-- The pre-send dry run has to know which email it is testing.
--
-- crm_touch_guard treats email_1 differently: a FIRST email needs a finding
-- specific to the company's technical domain plus a positive finding, because
-- that is what makes an opening message worth reading. A follow-up carries no
-- such requirement, being a continuation rather than an introduction.
--
-- The original dry run hardcoded email_1, so a scheduled follow-up would have
-- been tested against the opening-email gate and refused. Three of the eighteen
-- sends in the week of 10 August are follow-ups, including the first one out on
-- Monday morning.
--
-- Dropped and recreated rather than given a defaulted third argument, because
-- an overload differing only by a default makes every existing two-argument
-- call ambiguous.
--
-- Run after 0036. Idempotent.

drop function if exists public.crm_dry_run_touch(uuid, jsonb);
drop function if exists public.crm_dry_run_touch(uuid, jsonb, text);

create function public.crm_dry_run_touch(
  p_contact_id uuid,
  p_checks jsonb,
  p_step text
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
    values (p_contact_id, p_contact_id, 'email', p_step, 'out', p_checks);
    raise exception '__crm_dry_run_ok__';
  exception
    when others then
      if sqlerrm = '__crm_dry_run_ok__' then
        return;
      end if;
      raise;
  end;
end; $$;

revoke all on function public.crm_dry_run_touch(uuid, jsonb, text) from public;
grant execute on function public.crm_dry_run_touch(uuid, jsonb, text) to authenticated;
