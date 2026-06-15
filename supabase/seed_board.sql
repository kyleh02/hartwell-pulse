-- =============================================================================
-- Hartwell Pulse — a few demo board cards (admin kanban / calendar)
-- Run after seed_demo.sql. Only seeds when the board is empty, so it won't
-- duplicate cards you create yourself.
-- =============================================================================

do $$
declare
  v_client uuid := '11111111-1111-1111-1111-111111111111';
  v_admin text;
  v_month date := date_trunc('month', now())::date;
begin
  select clerk_user_id into v_admin from public.client_users where role = 'admin' limit 1;

  if not exists (select 1 from public.board_cards) then
    insert into public.board_cards
      (client_id, title, description, column_key, card_type, position, due_date, created_by)
    values
      (v_client, 'Monthly report for Demo Co', 'Pull metrics, write insights and recommendations, publish.', 'in_progress', 'report', 0, (v_month + interval '14 days')::date, v_admin),
      (v_client, 'New Google Ads headlines', 'Draft three variations to test this fortnight.', 'pending', 'ad_copy', 0, (v_month + interval '6 days')::date, v_admin),
      (v_client, 'Instagram carousel', 'Promo for the winter sale.', 'pending', 'social', 1, (v_month + interval '9 days')::date, v_admin),
      (v_client, 'Landing page refresh', 'Tidy the hero and speed up load time.', 'in_progress', 'website', 1, (v_month + interval '20 days')::date, v_admin),
      (v_client, 'Last month report', 'Delivered and published.', 'delivered', 'report', 0, (v_month - interval '16 days')::date, v_admin);
  end if;
end $$;
