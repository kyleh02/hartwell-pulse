-- =============================================================================
-- Hartwell Pulse - 0026 CRM daily activity
-- Per-day send counts, so the dashboard can show a streak and a fortnight of
-- shape rather than a single number with no context. Evaluated in
-- Australia/Brisbane, like the recurring billing cron, so a day boundary means
-- the same thing everywhere in the app.
-- Run after 0025. Idempotent.
-- =============================================================================

create or replace function public.crm_activity_days(
  p_days integer default 14,
  p_brand text default null
)
returns table (day date, sent bigint)
language sql stable security definer set search_path = public as $$
  with span as (
    select generate_series(
      (date_trunc('day', now() at time zone 'Australia/Brisbane')
        - make_interval(days => p_days - 1))::date,
      (date_trunc('day', now() at time zone 'Australia/Brisbane'))::date,
      interval '1 day'
    )::date as day
  ),
  sends as (
    select (t.sent_at at time zone 'Australia/Brisbane')::date as day, count(*) as n
    from public.crm_touches t
    join public.crm_organisations o on o.id = t.organisation_id
    where t.direction = 'out'
      and t.channel = 'email'
      and (p_brand is null or o.brand = p_brand)
    group by 1
  )
  select span.day, coalesce(sends.n, 0)::bigint
  from span left join sends on sends.day = span.day
  order by span.day;
$$;
grant execute on function public.crm_activity_days(integer, text) to authenticated;
