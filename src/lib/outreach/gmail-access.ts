import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openToken, sealToken, tokenKey } from "./crypto.ts";
import { refreshAccess, revokeToken, SENDER_EMAIL } from "./gmail.ts";

/**
 * The stored Gmail connection (outreach_gmail, service role only). Callers pass
 * the service-role client after their own admin or cron check.
 */

export interface GmailConnection {
  email: string;
  scopes: string[];
  connected_at: string;
}

export async function gmailConnection(db: SupabaseClient): Promise<GmailConnection | null> {
  const { data } = await db.from("outreach_gmail").select("email, scopes, connected_at").maybeSingle();
  return (data as GmailConnection | null) ?? null;
}

export async function saveConnection(db: SupabaseClient, refreshToken: string, scopes: string[], by: string): Promise<void> {
  const key = tokenKey();
  if (!key) throw new Error("OUTREACH_TOKEN_KEY isn't set (32 random bytes, base64), so the token can't be stored safely");
  const { error } = await db.from("outreach_gmail").upsert({
    id: true,
    email: SENDER_EMAIL,
    refresh_token_enc: sealToken(refreshToken, key),
    scopes,
    connected_by: by,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Couldn't store the Gmail connection: ${error.message}`);
}

let cached: { token: string; until: number } | null = null;

/** A fresh access token for kyle@, or why there isn't one. */
export async function gmailAccessToken(db: SupabaseClient): Promise<{ token: string } | { error: string }> {
  if (cached && cached.until > Date.now()) return { token: cached.token };
  const key = tokenKey();
  if (!key) return { error: "OUTREACH_TOKEN_KEY isn't set" };
  const { data, error } = await db.from("outreach_gmail").select("refresh_token_enc").maybeSingle();
  if (error) return { error: `Couldn't read the Gmail connection: ${error.message}` };
  if (!data) return { error: "Gmail isn't connected. Connect it on the Draper page." };
  try {
    const token = await refreshAccess(openToken((data as { refresh_token_enc: string }).refresh_token_enc, key));
    cached = { token, until: Date.now() + 45 * 60_000 };
    return { token };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function disconnectGmail(db: SupabaseClient): Promise<void> {
  const key = tokenKey();
  const { data } = await db.from("outreach_gmail").select("refresh_token_enc").maybeSingle();
  if (data && key) {
    try {
      await revokeToken(openToken((data as { refresh_token_enc: string }).refresh_token_enc, key));
    } catch {
      // A token that won't open can't be revoked; deleting it is still right.
    }
  }
  cached = null;
  await db.from("outreach_gmail").delete().eq("id", true);
}
