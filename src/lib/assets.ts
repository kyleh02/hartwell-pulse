import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset } from "@/lib/types/database";
import type { AssetWithUrl } from "@/lib/assets-shared";

/**
 * Attach short-lived signed URLs (and optional client names) to asset rows.
 * Signs both the original and the thumbnail in a single batched round-trip.
 */
export async function signAssets(
  supabase: SupabaseClient,
  assets: Asset[],
  clientNames?: Map<string, string>,
): Promise<AssetWithUrl[]> {
  const pathSet = new Set<string>();
  for (const a of assets) {
    if (a.storage_path) pathSet.add(a.storage_path);
    if (a.thumb_path) pathSet.add(a.thumb_path);
  }
  const paths = [...pathSet];
  const urls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data } = await supabase.storage
      .from("pulse-assets")
      .createSignedUrls(paths, 60 * 60);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
    }
  }
  return assets.map((a) => ({
    ...a,
    url: urls[a.storage_path] ?? null,
    thumb_url: a.thumb_path ? (urls[a.thumb_path] ?? null) : null,
    client_name: clientNames?.get(a.client_id) ?? null,
  }));
}
