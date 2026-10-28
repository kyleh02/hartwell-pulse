-- =============================================================================
-- 0055 — client onboarding
--
-- A new client's first job in the portal: a welcome from Kyle, what happens
-- next, a short form about their business, a checklist of the access Kyle
-- needs (never passwords: they add admin@hartwelldigital.com instead), their
-- files, and a kickoff call booked through Kyle's own booking link.
--
-- The answers are one JSON document per client, because the questions will
-- change as Kyle refines them, and a column per question would need a
-- migration every time he does. The shape is defined once, in
-- src/lib/onboarding-shared.ts.
--
-- Run after 0054. Idempotent.
-- =============================================================================

create table if not exists public.onboarding (
  client_id uuid primary key references public.clients(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted')),
  submitted_at timestamptz,
  submitted_by text,
  -- The client said they had booked the kickoff call.
  kickoff_booked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists onboarding_set_updated_at on public.onboarding;
create trigger onboarding_set_updated_at
  before update on public.onboarding
  for each row execute function public.set_updated_at();

alter table public.onboarding enable row level security;
grant select, insert, update on public.onboarding to authenticated;

drop policy if exists onboarding_admin_all on public.onboarding;
create policy onboarding_admin_all on public.onboarding
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- A client reads and writes their own answers. Submitting goes through a
-- server action, which is what tells Kyle and puts the review on his list.
drop policy if exists onboarding_client_read on public.onboarding;
create policy onboarding_client_read on public.onboarding
  for select to authenticated
  using (client_id = public.current_client_id());

drop policy if exists onboarding_client_write on public.onboarding;
create policy onboarding_client_write on public.onboarding
  for insert to authenticated
  with check (client_id = public.current_client_id());

drop policy if exists onboarding_client_update on public.onboarding;
create policy onboarding_client_update on public.onboarding
  for update to authenticated
  using (client_id = public.current_client_id())
  with check (client_id = public.current_client_id());

-- Kyle's booking link and his welcome note, set in Settings.
alter table public.business_settings
  add column if not exists kickoff_url text,
  add column if not exists welcome_message text;

notify pgrst, 'reload schema';
