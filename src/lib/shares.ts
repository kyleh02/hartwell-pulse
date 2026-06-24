import "server-only";
import { createHash } from "crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { Share } from "@/lib/types/database";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Validate a share token. Returns the share row, or null if it's unknown,
 * revoked, expired, or used up. Fails closed on every check.
 */
export async function resolveShare(token: string): Promise<Share | null> {
  if (!token) return null;
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("shares")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  const share = data as Share | null;
  if (!share) return null;
  if (share.revoked_at) return null;
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now())
    return null;
  if (share.max_uses != null && share.use_count >= share.max_uses) return null;
  return share;
}
