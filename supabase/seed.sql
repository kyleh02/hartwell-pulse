-- =============================================================================
-- Hartwell Pulse — optional seed data
-- Handy for poking around before real clients exist. Safe to skip.
-- Run AFTER 0001/0002/0003. Run it from the SQL editor (service role), which
-- bypasses RLS so the inserts go through.
-- =============================================================================

-- 1) Map YOUR Clerk user to the admin role.
--    Sign in to the app once so Clerk creates your user, grab your user id from
--    the Clerk dashboard (looks like user_2abc...), then run:
--
--    insert into public.client_users (clerk_user_id, role, full_name, email)
--    values ('user_REPLACE_WITH_YOUR_CLERK_ID', 'admin', 'Kyle', 'admin@hartwelldigital.com')
--    on conflict (clerk_user_id) do update set role = 'admin';

-- 2) A demo client to look at.
insert into public.clients (id, business_name, slug, service_tier, status)
values ('11111111-1111-1111-1111-111111111111', 'Demo Co', 'demo-co', 'growth', 'active')
on conflict (id) do nothing;

-- 3) The services Demo Co uses.
insert into public.services (client_id, service_key, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'google_ads', 'Google Ads'),
  ('11111111-1111-1111-1111-111111111111', 'meta_ads', 'Meta Ads'),
  ('11111111-1111-1111-1111-111111111111', 'email', 'Email Marketing'),
  ('11111111-1111-1111-1111-111111111111', 'website', 'Website Traffic')
on conflict (client_id, service_key) do nothing;

-- 4) A couple of months of sample metrics so the dashboard has something to draw.
insert into public.metrics (client_id, service_key, metric_key, label, value, unit, period_month) values
  ('11111111-1111-1111-1111-111111111111', 'google_ads', 'leads', 'Leads generated', 38, 'count', date_trunc('month', now() - interval '1 month')::date),
  ('11111111-1111-1111-1111-111111111111', 'google_ads', 'leads', 'Leads generated', 47, 'count', date_trunc('month', now())::date),
  ('11111111-1111-1111-1111-111111111111', 'google_ads', 'cost_per_lead', 'Cost per lead', 42.10, 'aud', date_trunc('month', now() - interval '1 month')::date),
  ('11111111-1111-1111-1111-111111111111', 'google_ads', 'cost_per_lead', 'Cost per lead', 37.80, 'aud', date_trunc('month', now())::date),
  ('11111111-1111-1111-1111-111111111111', 'website', 'sessions', 'Website sessions', 5120, 'count', date_trunc('month', now() - interval '1 month')::date),
  ('11111111-1111-1111-1111-111111111111', 'website', 'sessions', 'Website sessions', 6043, 'count', date_trunc('month', now())::date)
on conflict (client_id, service_key, metric_key, period_month) do nothing;

-- 5) To see the client side, create a second Clerk user and map them:
--    insert into public.client_users (clerk_user_id, client_id, role, full_name, email)
--    values ('user_REPLACE_WITH_CLIENT_CLERK_ID', '11111111-1111-1111-1111-111111111111', 'client', 'Demo Client', 'demo@example.com');
