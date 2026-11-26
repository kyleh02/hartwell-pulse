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

/**
 * The newest Meta check no older than `maxHours` that showed live ads: how
 * many active ads point at their site, when the earliest started, and the
 * page text Pulse read (the give-first template quotes from it). Null when
 * there's none.
 */
export async function metaCheckFor(
  db: SupabaseClient,
  prospectId: string,
  now: Date,
  maxHours: number,
): Promise<{ ads: number; started: string | null; pageText: string } | null> {
  const { data, error } = await db.from("outreach_events").select("detail").eq("prospect_id", prospectId).eq("kind", "checked");
  if (error) throw new Error(`outreach_events: ${error.message}`);
  const rows = ((data as { detail: { ads?: AdsEvidence; page_text?: string } | null }[] | null) ?? [])
    .filter((r) => r.detail?.ads?.platform === "meta" && typeof r.detail.ads.checked_at === "string")
    .sort((a, b) => b.detail!.ads!.checked_at.localeCompare(a.detail!.ads!.checked_at));
  const newest = rows[0]?.detail;
  if (!newest?.ads?.live || now.getTime() - Date.parse(newest.ads.checked_at) > maxHours * 3_600_000) return null;
  return { ads: newest.ads.ads, started: newest.ads.started, pageText: newest.page_text ?? "" };
}
