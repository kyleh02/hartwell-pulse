"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { outreachEnabled } from "@/lib/outreach/flag";
import { requestOrigin } from "@/lib/mcp/http";
import { OUTREACH, OUTREACH_ADVISOR, resourceUrl } from "@/lib/mcp/resources";

/**
 * Cut off one Draper connector now: every token issued for that address stops
 * working on its next request. The pipeline connector, and the other Draper
 * one, are left alone (Settings' Disconnect cuts off a whole app instead).
 */
export async function disconnectDraper(scope: string): Promise<{ ok: boolean; message?: string }> {
  if (!outreachEnabled()) throw new Error("Not found");
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  const def = [OUTREACH, OUTREACH_ADVISOR].find((d) => d.scope === scope);
  if (!def) return { ok: false, message: "That isn't a Draper connector." };
  const sb = createAdminSupabase();
  const { error } = await sb
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("resource", resourceUrl(await requestOrigin(), def))
    .is("revoked_at", null);
  await sb.from("outreach_change_log").insert({ what: `${def.name} disconnected`, changed_by: session.clerkUserId });
  revalidatePath("/admin/outreach");
  return error ? { ok: false, message: error.message } : { ok: true };
}
