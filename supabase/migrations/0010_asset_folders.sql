-- =============================================================================
-- Hartwell Pulse — 0010 asset folders (Phase 1: OneDrive-style filing)
-- Additive + non-destructive. A nested folder tree (adjacency list via parent_id)
-- supersedes the flat `assets.folder` text label; assets gain folder_id + a
-- thumbnail path + a per-asset lock (used by Phase 2 permissions). Existing
-- uploads keep working: folder_id is nullable and the legacy `folder` column
-- stays during the transition. Storage paths are untouched — a folder move only
-- re-points folder_id, it never moves a stored file. Run after 0009.
-- =============================================================================

create table if not exists public.asset_folders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  parent_id uuid references public.asset_folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  created_by text,
  created_at timestamptz not null default now(),
  -- siblings can't share a name within the same parent (nulls-not-distinct so two
  -- top-level folders, parent_id null, with the same name also collide)
  constraint asset_folders_sibling_uniq
    unique nulls not distinct (client_id, parent_id, name)
);
create index if not exists asset_folders_client_idx on public.asset_folders(client_id);
create index if not exists asset_folders_parent_idx on public.asset_folders(parent_id);

alter table public.assets
  add column if not exists folder_id uuid references public.asset_folders(id) on delete set null,
  add column if not exists thumb_path text,
  add column if not exists locked boolean not null default false;
create index if not exists assets_client_folder_created_idx
  on public.assets(client_id, folder_id, created_at desc);

-- Cycle guard: a folder can't be its own parent or be moved into a descendant.
create or replace function public.asset_folders_no_cycle()
returns trigger language plpgsql set search_path = public as $$
declare cur uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'a folder cannot be its own parent';
  end if;
  cur := new.parent_id;
  while cur is not null loop
    if cur = new.id then
      raise exception 'cannot move a folder into its own descendant';
    end if;
    select parent_id into cur from public.asset_folders where id = cur;
  end loop;
  return new;
end $$;
drop trigger if exists asset_folders_no_cycle_trg on public.asset_folders;
create trigger asset_folders_no_cycle_trg
  before insert or update of parent_id on public.asset_folders
  for each row execute function public.asset_folders_no_cycle();

-- ---------- RLS (mirrors the existing assets policies) ----------
grant select, insert, update, delete on public.asset_folders to authenticated;
alter table public.asset_folders enable row level security;

create policy asset_folders_admin_all on public.asset_folders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy asset_folders_client_read on public.asset_folders
  for select to authenticated using (client_id = public.current_client_id());
create policy asset_folders_client_write on public.asset_folders
  for all to authenticated
  using (client_id = public.current_client_id())
  with check (client_id = public.current_client_id());

-- ---------- Backfill: a top-level folder per distinct legacy label ----------
insert into public.asset_folders (client_id, name)
select distinct a.client_id, a.folder
  from public.assets a
 where a.folder is not null and a.folder <> ''
on conflict on constraint asset_folders_sibling_uniq do nothing;

update public.assets a
   set folder_id = f.id
  from public.asset_folders f
 where f.client_id = a.client_id
   and f.parent_id is null
   and f.name = a.folder
   and a.folder is not null and a.folder <> ''
   and a.folder_id is null;
