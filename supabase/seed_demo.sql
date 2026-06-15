-- =============================================================================
-- Hartwell Pulse — demo dashboard data
-- Run in the Supabase SQL Editor (service role bypasses RLS). Idempotent and
-- re-runnable. Creates "Demo Co" with six months of metrics across four
-- services so the client dashboard has real-looking trends to draw.
-- =============================================================================

-- Demo client
insert into public.clients (id, business_name, slug, service_tier, status)
values ('11111111-1111-1111-1111-111111111111', 'Demo Co', 'demo-co', 'growth', 'active')
on conflict (id) do update set status = excluded.status;

-- Services this client uses (drives which dashboard sections appear)
insert into public.services (client_id, service_key, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'google_ads', 'Google Ads'),
  ('11111111-1111-1111-1111-111111111111', 'meta_ads',   'Meta Ads'),
  ('11111111-1111-1111-1111-111111111111', 'website',    'Website Traffic'),
  ('11111111-1111-1111-1111-111111111111', 'email',      'Email Marketing')
on conflict (client_id, service_key) do nothing;

-- Six months of metrics. n = 0 (five months ago) .. 5 (this month).
-- period = first of (this month minus (5-n) months).
with months as (
  select
    n,
    (date_trunc('month', now()) - ((5 - n) || ' months')::interval)::date as period
  from generate_series(0, 5) as n
),
seed (service_key, metric_key, label, unit) as (
  values
    -- Google Ads (leads / cost_per_lead / conversion_rate are the headline cards)
    ('google_ads', 'leads',                'Leads generated',    'count'),
    ('google_ads', 'cost_per_lead',        'Cost per lead',      'aud'),
    ('google_ads', 'conversion_rate',      'Conversion rate',    'percent'),
    ('google_ads', 'ad_spend',             'Ad spend',           'aud'),
    ('google_ads', 'clicks',               'Clicks',             'count'),
    ('google_ads', 'ctr',                  'Click-through rate', 'percent'),
    -- Meta Ads
    ('meta_ads',   'reach',                'Reach',              'count'),
    ('meta_ads',   'impressions',          'Impressions',        'count'),
    ('meta_ads',   'ctr',                  'Click-through rate', 'percent'),
    ('meta_ads',   'ad_spend',             'Ad spend',           'aud'),
    -- Website (sessions is the headline card)
    ('website',    'sessions',             'Website sessions',   'count'),
    ('website',    'users',                'Users',              'count'),
    ('website',    'bounce_rate',          'Bounce rate',        'percent'),
    ('website',    'avg_session_duration', 'Avg session time',   'seconds'),
    -- Email (open_rate is the headline card)
    ('email',      'open_rate',            'Open rate',          'percent'),
    ('email',      'click_rate',           'Click rate',         'percent'),
    ('email',      'subscribers',          'Subscribers',        'count'),
    ('email',      'unsubscribes',         'Unsubscribes',       'count')
)
insert into public.metrics (client_id, service_key, metric_key, label, value, unit, period_month)
select
  '11111111-1111-1111-1111-111111111111',
  s.service_key,
  s.metric_key,
  s.label,
  case s.service_key || ':' || s.metric_key
    when 'google_ads:leads'              then 30 + 4 * m.n
    when 'google_ads:cost_per_lead'      then 48 - 2 * m.n
    when 'google_ads:conversion_rate'    then 3.1 + 0.2 * m.n
    when 'google_ads:ad_spend'           then 1800 + 100 * m.n
    when 'google_ads:clicks'             then 900 + 60 * m.n
    when 'google_ads:ctr'                then 2.4 + 0.1 * m.n
    when 'meta_ads:reach'                then 12000 + 1500 * m.n
    when 'meta_ads:impressions'          then 26000 + 2000 * m.n
    when 'meta_ads:ctr'                  then 1.6 + 0.08 * m.n
    when 'meta_ads:ad_spend'             then 1200 + 80 * m.n
    when 'website:sessions'              then 4200 + 350 * m.n
    when 'website:users'                 then 3100 + 260 * m.n
    when 'website:bounce_rate'           then 52 - 1.5 * m.n
    when 'website:avg_session_duration'  then 120 + 8 * m.n
    when 'email:open_rate'               then 28 + 1.2 * m.n
    when 'email:click_rate'              then 3.2 + 0.25 * m.n
    when 'email:subscribers'             then 2400 + 120 * m.n
    when 'email:unsubscribes'            then 30 - 2 * m.n
    else 0
  end,
  s.unit,
  m.period
from seed s
cross join months m
on conflict (client_id, service_key, metric_key, period_month)
do update set value = excluded.value, label = excluded.label, unit = excluded.unit;

-- -----------------------------------------------------------------------------
-- To sign in AS this client and see the true client-side view:
--   1) Create a second user in the Clerk dashboard (Users -> Create user).
--   2) Copy that user's id (user_...), then run:
--
--   insert into public.client_users (clerk_user_id, client_id, role, full_name, email)
--   values ('user_DEMO_CLIENT_ID', '11111111-1111-1111-1111-111111111111', 'client', 'Demo Client', 'demo@example.com')
--   on conflict (clerk_user_id) do update set client_id = excluded.client_id, role = 'client';
-- -----------------------------------------------------------------------------
