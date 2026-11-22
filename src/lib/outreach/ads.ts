import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdsEvidence } from "./ads-rules.ts";

/**
 * Every ad-library check on record for a business: Pulse's own reading of
 * each (ads-rules.ts), stored as an outreach_events row of kind "checked"
 * with the page text beside it. Events rather than a table of their own so
 * the plan could ship the night Kyle chose it, with no migration to paste;
 * the text is the permanent record, because Meta drops ads from its library
 * once they stop.
 */
export async function adsEvidenceFor(db: SupabaseClient, prospectId: string): Promise<AdsEvidence[]> {
  const { data, error } = await db.from("outreach_events").select("detail").eq("prospect_id", prospectId).eq("kind", "checked");
  if (error) throw new Error(`outreach_events: ${error.message}`);
  return ((data as { detail: { ads?: AdsEvidence } | null }[] | null) ?? [])
    .map((r) => r.detail?.ads)
    .filter((x): x is AdsEvidence => !!x && typeof x.checked_at === "string" && (x.platform === "meta" || x.platform === "google"));
}
