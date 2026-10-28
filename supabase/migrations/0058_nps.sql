-- 0058: client feedback (NPS), Stage 7.
--
-- One question, 0 to 10: how likely are you to recommend Hartwell Digital?
-- Asked 30 days after a client starts, then every quarter, of each person on
-- the account, in the portal and by email. Off until Kyle switches it on in
-- Settings (nps_enabled), so deploying this emails nobody.
--
-- A client only ever READS their own survey rows, through RLS. Answers are
-- written by server actions with the service role after checking the survey
-- is theirs (or, from an email link, that the token matches its hash).
--
-- Safe to run more than once.

create table if not exists public.nps_surveys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id text not null,
  email text,
  -- The email link's credential, stored as a SHA-256 hash.
  token_hash text not null unique,
  kind text not null check (kind in ('first', 'quarterly')),
  -- The business date the round was raised, one round per person per date.
  round date not null,
  closes_at timestamptz not null,
  sent_at timestamptz,
  score int check (score between 0 and 10),
  comment text,
  answered_at timestamptz,
  answered_via text check (answered_via in ('portal', 'email')),
  review_asked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, user_id, round)
);
create index if not exists nps_surveys_client_idx on public.nps_surveys (client_id, created_at desc);

alter table public.nps_surveys enable row level security;
grant select on public.nps_surveys to authenticated;
drop policy if exists nps_surveys_admin_all on public.nps_surveys;
create policy nps_surveys_admin_all on public.nps_surveys
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists nps_surveys_own_read on public.nps_surveys;
create policy nps_surveys_own_read on public.nps_surveys
  for select to authenticated
  using (client_id = public.current_client_id() and user_id = public.clerk_user_id());

alter table public.business_settings add column if not exists nps_enabled boolean not null default false;
alter table public.business_settings add column if not exists google_review_url text;

notify pgrst, 'reload schema';
