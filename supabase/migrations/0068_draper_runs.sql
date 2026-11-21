-- =============================================================================
-- 0068: Draper. A report from every morning run (Kyle, 21 November 2026).
--
-- Pulse sees what a run adds, measures, submits and drops, but not the sites
-- it read and skipped before adding anything: no email published, outside
-- the lane's areas, an ABN that didn't match, a directory page, a site that
-- wouldn't load. The run now ends with outreach_finish_run, which records its
-- own counts here, so the Draper page can show what each morning cost
-- against what it produced.
--
-- The counts are the run's own word, not Pulse's measurement, and the page
-- says so. Admins read and add; nothing is changed or removed. Safe to run
-- more than once.
-- =============================================================================

create table if not exists public.outreach_runs (
  id uuid primary key default gen_random_uuid(),
  ran_on date not null default ((now() at time zone 'Australia/Melbourne')::date),
  sites_read int not null default 0 check (sites_read >= 0 and sites_read <= 1000),
  added int not null default 0 check (added >= 0),
  measured int not null default 0 check (measured >= 0),
  submitted int not null default 0 check (submitted >= 0),
  dropped int not null default 0 check (dropped >= 0),
  -- { "<reason>": <count> } for sites skipped before they were added, and
  -- for prospects dropped after measuring.
  skipped jsonb not null default '{}',
  dropped_reasons jsonb not null default '{}',
  summary text,
  -- Run while test mode was on.
  test boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists outreach_runs_ran_on_idx on public.outreach_runs (ran_on desc, created_at desc);

alter table public.outreach_runs enable row level security;
revoke all on public.outreach_runs from anon, authenticated;
grant select, insert on public.outreach_runs to authenticated;
drop policy if exists outreach_runs_admin_read on public.outreach_runs;
create policy outreach_runs_admin_read on public.outreach_runs for select to authenticated using (public.is_admin());
drop policy if exists outreach_runs_admin_add on public.outreach_runs;
create policy outreach_runs_admin_add on public.outreach_runs for insert to authenticated with check (public.is_admin());

comment on table public.outreach_runs is 'Draper: each morning run''s own report of what it read, skipped, added, measured, submitted and dropped.';

notify pgrst, 'reload schema';
