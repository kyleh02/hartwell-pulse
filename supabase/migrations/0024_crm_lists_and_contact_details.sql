-- =============================================================================
-- Hartwell Pulse - 0024 CRM source lists + fuller contact details
--
-- Prospects now belong to a named source list. The 59 companies loaded so far
-- all came from one place, the Defence Industry Development Grant announcement,
-- and knowing where a prospect came from is not filing: it is what makes the
-- first email specific. A grant recipient gets approached about the thing they
-- were funded to build. Someone found at a trade show does not.
--
-- Keeping lists separate also keeps the campaign metrics honest. Reply rates
-- from a grant list and a cold trade-show list are not the same number and
-- should not be averaged into one.
--
-- Contacts gain a phone number and a direct email. The direct email is
-- deliberately NOT the same field as email_as_published: that one is the
-- verbatim published address the Spam Act consent rests on, and overwriting it
-- with a personal address someone gave you later would quietly destroy the
-- evidence. Both are kept.
-- Run after 0023. Idempotent.
-- =============================================================================

create table if not exists public.crm_lists (
  id uuid primary key default gen_random_uuid(),
  brand text not null default 'ironpeak',
  slug text not null unique,
  name text not null,
  description text,
  -- Where the names came from, and when. This is the provenance an approach
  -- gets built on, so it is a first-class field rather than a note.
  source_note text,
  captured_on date,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.crm_lists to authenticated;
alter table public.crm_lists enable row level security;
drop policy if exists crm_lists_admin_all on public.crm_lists;
create policy crm_lists_admin_all on public.crm_lists
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.crm_organisations
  add column if not exists list_id uuid references public.crm_lists(id) on delete set null;
create index if not exists crm_org_list_idx on public.crm_organisations (list_id);

-- The list everything so far came from.
insert into public.crm_lists (brand, slug, name, description, source_note, captured_on)
values (
  'ironpeak',
  'didg-2026',
  'Defence Industry Development Grants',
  'Recipients of the Defence Industry Development Grant round announced in late July 2026. Every company here has public funding to build something specific, and that funded purpose is what an approach is built on.',
  'Parsed from the official Department of Defence recipient PDF. 67 grants across 59 companies, $21,778,587 in total.',
  '2026-07-30'
)
on conflict (slug) do nothing;

-- Anything already imported belongs to it.
update public.crm_organisations o
set list_id = l.id
from public.crm_lists l
where l.slug = 'didg-2026' and o.list_id is null;

-- ---------- contact details ----------
alter table public.crm_contacts
  add column if not exists phone text,
  -- A direct address someone gives you once you are talking. Never overwrites
  -- email_as_published, which stays as the consent evidence.
  add column if not exists direct_email text;
