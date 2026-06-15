import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset } from "@/lib/types/database";
import type { AssetWithUrl } from "@/lib/assets-shared";

/** Attach short-lived signed URLs (and optional client names) to asset rows. */
export async function signAssets(
  supabase: SupabaseClient,
  assets: Asset[],
  clientNames?: Map<string, string>,
): Promise<AssetWithUrl[]> {
  const paths = assets.map((a) => a.storage_path).filter(Boolean);
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
    client_name: clientNames?.get(a.client_id) ?? null,
  }));
}
