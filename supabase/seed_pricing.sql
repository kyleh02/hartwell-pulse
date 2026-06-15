-- =============================================================================
-- Hartwell Pulse — pricing catalogue seed
-- Seeds the service tiers from the Hartwell Digital site with $0 amounts for
-- you to fill in under Settings. Only runs if the catalogue is empty.
-- =============================================================================

do $$
begin
  if not exists (select 1 from public.pricing_items) then
    insert into public.pricing_items (category, name, tier, description, default_amount, position) values
      ('Google Ads', 'Google Ads management', 'Starter', 'For businesses new to Google Ads who want to start smart.', 0, 0),
      ('Google Ads', 'Google Ads management', 'Growth', 'For businesses ready to grow lead volume and dominate their local market.', 0, 1),
      ('Google Ads', 'Google Ads management', 'Full Service', 'For established businesses who want a complete paid search strategy.', 0, 2),
      ('Meta Ads', 'Meta Ads management', 'Starter', null, 0, 3),
      ('Meta Ads', 'Meta Ads management', 'Growth', null, 0, 4),
      ('Meta Ads', 'Meta Ads management', 'Full Service', null, 0, 5),
      ('Email Marketing', 'Email marketing', 'Starter', null, 0, 6),
      ('Email Marketing', 'Email marketing', 'Growth', null, 0, 7),
      ('Email Marketing', 'Email marketing', 'Full Service', null, 0, 8),
      ('Web Design', 'Website design', 'Project', null, 0, 9),
      ('Lead Generation', 'Lead generation', 'Monthly', null, 0, 10),
      ('Brand Development', 'Brand development', 'Project', null, 0, 11);
  end if;
end $$;
