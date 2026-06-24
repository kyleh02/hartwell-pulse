-- =============================================================================
-- Hartwell Pulse — 0011 per-folder edit permissions + per-asset lock enforcement
-- Adds asset_folders.client_editable (admin-controlled view-only switch) and
-- enforces it, plus the existing assets.locked, via RESTRICTIVE policies layered
-- on top of the existing tenancy policies. SELECT is deliberately untouched, so a
-- view-only folder stays fully readable by the client — only client WRITES are
-- gated. Admin (is_admin) and the service role are never restricted. Run after 0010.
-- =============================================================================

alter table public.asset_folders
  add column if not exists client_editable boolean not null default true;

-- Read-only resolver: is this folder client-editable? (root / null = editable)
create or replace function public.folder_editable(p_folder_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_folder_id is null then true
    else coalesce(
      (select client_editable from public.asset_folders where id = p_folder_id),
      true)
  end;
$$;
grant execute on function public.folder_editable(uuid) to authenticated;

-- ----- assets: clients may only write in editable folders, never locked files -----
drop policy if exists assets_restrict_insert on public.assets;
create policy assets_restrict_insert on public.assets
  as restrictive for insert to authenticated
  with check (public.is_admin() or public.folder_editable(folder_id));

drop policy if exists assets_restrict_update on public.assets;
create policy assets_restrict_update on public.assets
  as restrictive for update to authenticated
  using (public.is_admin() or (not locked and public.folder_editable(folder_id)))
  with check (public.is_admin() or (not locked and public.folder_editable(folder_id)));

drop policy if exists assets_restrict_delete on public.assets;
create policy assets_restrict_delete on public.assets
  as restrictive for delete to authenticated
  using (public.is_admin() or (not locked and public.folder_editable(folder_id)));

-- ----- folders: only admin sets view-only; clients can't modify view-only ones -----
drop policy if exists asset_folders_restrict_insert on public.asset_folders;
create policy asset_folders_restrict_insert on public.asset_folders
  as restrictive for insert to authenticated
  with check (public.is_admin() or public.folder_editable(parent_id));

drop policy if exists asset_folders_restrict_update on public.asset_folders;
create policy asset_folders_restrict_update on public.asset_folders
  as restrictive for update to authenticated
  using (public.is_admin() or client_editable)
  with check (public.is_admin() or client_editable);

drop policy if exists asset_folders_restrict_delete on public.asset_folders;
create policy asset_folders_restrict_delete on public.asset_folders
  as restrictive for delete to authenticated
  using (public.is_admin() or client_editable);

-- FK cascades (asset_folders.parent_id ON DELETE CASCADE, assets.folder_id ON
-- DELETE SET NULL) do NOT re-check RLS, so deleting an editable parent folder
-- could otherwise wipe an admin's nested view-only sub-folder or silently free a
-- locked asset (folder_id -> null). A BEFORE DELETE trigger fires on
-- cascade-deleted rows too, so it closes that gap where the RESTRICTIVE policy
-- cannot. Service role (no JWT) and admins are unrestricted.
create or replace function public.asset_folders_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.clerk_user_id() is null or public.is_admin() then
    return old;
  end if;
  if not old.client_editable then
    raise exception 'cannot delete a view-only folder';
  end if;
  if exists (select 1 from public.assets where folder_id = old.id and locked) then
    raise exception 'cannot delete a folder that contains a locked file';
  end if;
  return old;
end $$;
drop trigger if exists asset_folders_delete_guard_trg on public.asset_folders;
create trigger asset_folders_delete_guard_trg
  before delete on public.asset_folders
  for each row execute function public.asset_folders_delete_guard();
