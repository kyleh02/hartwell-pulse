"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";

export interface Connection {
  clientId: string;
  name: string;
  since: string;
  lastUsed: string | null;
}

async function admin() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return createAdminSupabase();
}

/**
 * What is connected right now: any app holding a refresh token that is still
 * live. The tables are service-role only (0057), hence the explicit check.
 * Returns null when 0057 has not been run.
 */
export async function listConnections(): Promise<Connection[] | null> {
  const sb = await admin();
  const { data, error } = await sb
    .from("mcp_tokens")
    .select("client_id, client_name, kind, created_at, last_used_at, expires_at, revoked_at")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if (error) return error.code === "PGRST205" || error.code === "42P01" ? null : [];
  const rows = (data as { client_id: string; client_name: string | null; kind: string; created_at: string; last_used_at: string | null }[]) ?? [];
  const by = new Map<string, Connection>();
  for (const r of rows) {
    const c = by.get(r.client_id) ?? { clientId: r.client_id, name: r.client_name || "Claude", since: r.created_at, lastUsed: null };
    if (r.created_at < c.since) c.since = r.created_at;
    if (r.last_used_at && (!c.lastUsed || r.last_used_at > c.lastUsed)) c.lastUsed = r.last_used_at;
    by.set(r.client_id, c);
  }
  // Only apps that can keep going count as connected: a lone access token
  // expires within the hour by itself.
  const live = new Set(rows.filter((r) => r.kind === "refresh").map((r) => r.client_id));
  return [...by.values()].filter((c) => live.has(c.clientId));
}

/** Cut an app off now: every token it holds stops working on its next request. */
export async function disconnect(clientId: string): Promise<{ ok: boolean }> {
  const sb = await admin();
  const { error } = await sb.from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("client_id", clientId).is("revoked_at", null);
  revalidatePath("/admin/settings");
  return { ok: !error };
}
