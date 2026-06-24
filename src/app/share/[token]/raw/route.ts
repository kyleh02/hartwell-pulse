import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { resolveShare } from "@/lib/shares";
import type { Asset } from "@/lib/types/database";

export const dynamic = "force-dynamic";

/**
 * Revalidate the share token on every file fetch, then 302 to a freshly minted
 * 60-second signed URL. The signed URL is never written into any HTML, and a
 * revoked/expired token fails closed here too — so killing a share kills live
 * file access, not just the landing page. Login is enforced by middleware.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const share = await resolveShare(token);
  if (!share) return new Response("Link not found or expired", { status: 404 });

  const admin = createAdminSupabase();
  let asset: Asset | null = null;

  if (share.asset_id) {
    // Single-asset share: only ever serve that one asset, ignore any ?asset.
    const { data } = await admin
      .from("assets")
      .select("*")
      .eq("id", share.asset_id)
      .eq("client_id", share.client_id)
      .maybeSingle();
    asset = data as Asset | null;
  } else if (share.folder_id) {
    // Folder share: the requested asset MUST be a direct child of the folder.
    const assetId = req.nextUrl.searchParams.get("asset");
    if (!assetId) return new Response("Missing asset", { status: 400 });
    const { data } = await admin
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("folder_id", share.folder_id)
      .eq("client_id", share.client_id)
      .maybeSingle();
    asset = data as Asset | null;
  }

  if (!asset) return new Response("Not found", { status: 404 });

  const { data: signed } = await admin.storage
    .from("pulse-assets")
    .createSignedUrl(asset.storage_path, 60);
  if (!signed?.signedUrl)
    return new Response("Could not prepare file", { status: 500 });

  return Response.redirect(signed.signedUrl, 302);
}
