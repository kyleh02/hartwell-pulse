import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetFolder } from "@/lib/types/database";

export interface FolderView {
  /** The folder currently being viewed (null = top level / root). */
  current: AssetFolder | null;
  /** Ancestors from root down to (and including) the current folder. */
  breadcrumb: AssetFolder[];
  /** Direct children of the current folder, name-sorted. */
  folders: AssetFolder[];
  /** Every folder for this client (used by the move picker). */
  allFolders: AssetFolder[];
}

/** All folders for a client. Trees are small per client, so one fetch is cheap. */
export async function getClientFolders(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AssetFolder[]> {
  const { data } = await supabase
    .from("asset_folders")
    .select("*")
    .eq("client_id", clientId)
    .order("name");
  return (data as AssetFolder[] | null) ?? [];
}

/** Build the breadcrumb + child list for a folder, in memory (no recursive query). */
export function buildFolderView(
  all: AssetFolder[],
  folderId: string | null,
): FolderView {
  const byId = new Map(all.map((f) => [f.id, f]));
  const current = folderId ? byId.get(folderId) ?? null : null;

  const breadcrumb: AssetFolder[] = [];
  const seen = new Set<string>();
  let node: AssetFolder | null = current;
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    breadcrumb.unshift(node);
    node = node.parent_id ? byId.get(node.parent_id) ?? null : null;
  }

  const parentKey = current?.id ?? null;
  const folders = all
    .filter((f) => f.parent_id === parentKey)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { current, breadcrumb, folders, allFolders: all };
}
