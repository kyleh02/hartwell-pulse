"use server";

import { randomBytes } from "crypto";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { hashToken } from "@/lib/shares";

type ShareInput = {
  assetId?: string;
  folderId?: string;
  expiresInDays?: number | null;
};

/**
 * Create a private share link. The raw token is returned to the caller exactly
 * once (to copy); only its hash is stored. The target is resolved under RLS, so
 * a caller can only share something they're already allowed to see.
 */
export async function createShare(
  input: ShareInput,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const session = await getPulseSession();
  if (!session?.clerkUserId) return { ok: false, error: "Not signed in" };
  if (!input.assetId && !input.folderId)
    return { ok: false, error: "Nothing to share" };

  const supabase = await createServerSupabase();

  let clientId: string | null = null;
  if (input.assetId) {
    const { data } = await supabase
      .from("assets")
      .select("client_id")
      .eq("id", input.assetId)
      .maybeSingle();
    clientId = (data as { client_id: string } | null)?.client_id ?? null;
  } else if (input.folderId) {
    const { data } = await supabase
      .from("asset_folders")
      .select("client_id")
      .eq("id", input.folderId)
      .maybeSingle();
    clientId = (data as { client_id: string } | null)?.client_id ?? null;
  }
  if (!clientId) return { ok: false, error: "Item not found" };

  const token = randomBytes(18).toString("base64url");
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
      : null;

  const { error } = await supabase.from("shares").insert({
    client_id: clientId,
    asset_id: input.assetId ?? null,
    folder_id: input.folderId ?? null,
    created_by: session.clerkUserId,
    token_hash: hashToken(token),
    require_login: true,
    expires_at: expiresAt,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token };
}

/** Revoke a share (RLS ensures only its owner or an admin can). */
export async function revokeShare(id: string): Promise<{ ok: boolean }> {
  const session = await getPulseSession();
  if (!session?.clerkUserId) return { ok: false };
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  return { ok: !error };
}
