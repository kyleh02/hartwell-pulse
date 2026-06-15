-- =============================================================================
-- Hartwell Pulse — a sample published report for Demo Co
-- Run AFTER seed_demo.sql. Idempotent. Gives the client report viewer something
-- to show straight away; you can also build your own via Reports -> New report.
-- =============================================================================

do $$
declare
  v_client uuid := '11111111-1111-1111-1111-111111111111';
  v_period date := date_trunc('month', now())::date;
  v_report uuid;
begin
  insert into public.reports (client_id, period_month, title, status, published_at)
  values (v_client, v_period, to_char(v_period, 'FMMonth YYYY') || ' report', 'published', now())
  on conflict (client_id, period_month)
    do update set status = 'published', published_at = now(), title = excluded.title
  returning id into v_report;

  delete from public.report_sections where report_id = v_report;

  insert into public.report_sections (report_id, client_id, kind, title, body, content, position)
  values
    (v_report, v_client, 'metrics', 'Google Ads', null,
      jsonb_build_object('blocks', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid()::text, 'type', 'metric', 'serviceKey', 'google_ads', 'metricKey', 'leads', 'chart', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'type', 'metric', 'serviceKey', 'google_ads', 'metricKey', 'cost_per_lead', 'chart', false),
        jsonb_build_object('id', gen_random_uuid()::text, 'type', 'metric', 'serviceKey', 'google_ads', 'metricKey', 'conversion_rate', 'chart', false)
      )), 0),
    (v_report, v_client, 'metrics', 'Website Traffic', null,
      jsonb_build_object('blocks', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid()::text, 'type', 'metric', 'serviceKey', 'website', 'metricKey', 'sessions', 'chart', true)
      )), 1),
    (v_report, v_client, 'insights', 'Insights',
      E'Really solid month across the board. Leads from Google Ads are up again and the cost to get each one keeps dropping, so the budget is working harder than it was.\n\nWebsite sessions climbed too, which means more of the right people are landing on the site and sticking around.',
      jsonb_build_object('blocks', jsonb_build_array()), 2),
    (v_report, v_client, 'recommendations', 'Recommendations',
      E'- Shift a bit more budget toward the Google Ads campaigns pulling the cheapest leads\n- Test two new ad headlines to keep the click rate moving\n- Refresh the top landing page so the extra traffic converts even better',
      jsonb_build_object('blocks', jsonb_build_array()), 3);

  -- A couple of reusable snippets for the builder's library (admin only).
  insert into public.insight_snippets (owner_user_id, category, title, body)
  select cu.clerk_user_id, 'Google Ads', 'Cost per lead improving',
    'Cost per lead came down again this month, so the budget is working harder than it was.'
  from public.client_users cu
  where cu.role = 'admin'
    and not exists (select 1 from public.insight_snippets s where s.title = 'Cost per lead improving');

  insert into public.insight_snippets (owner_user_id, category, title, body)
  select cu.clerk_user_id, 'Website', 'Traffic trending up',
    'Website sessions are climbing month on month, so more of the right people are finding you.'
  from public.client_users cu
  where cu.role = 'admin'
    and not exists (select 1 from public.insight_snippets s where s.title = 'Traffic trending up');
end $$;
