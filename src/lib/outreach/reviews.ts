import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBusiness } from "./check.ts";
import type { CompetitorCheck } from "./competitors-rules.ts";

/**
 * The free review's competitor search, on Pulse's side (Kyle, 27 November
 * 2026). Who is waiting for one: a business whose reply is labelled
 * interested or question in the last fortnight, with no competitor search
 * since that reply. The PC run does them the morning after a yes. The
 * search is stored as an outreach_events row of kind "checked" with
 * detail.competitors, beside the ad-library checks, so it needed no
 * migration (ads.ts reads only rows with detail.ads).
 */

export interface ReviewWaiting {
  prospectId: string;
  businessName: string | null;
  domain: string | null;
  suburb: string | null;
  laneId: number | null;
  label: string;
  repliedAt: string;
}

type Ev = { prospect_id: string; at: string; detail: { competitors?: CompetitorCheck } | null };

export async function reviewsWaiting(db: SupabaseClient, now: Date): Promise<ReviewWaiting[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const { data: replies, error } = await db
    .from("outreach_replies")
    .select("prospect_id, label, received_at, labelled_at")
    .eq("kind", "reply")
    .in("label", ["interested", "question"])
    .gte("labelled_at", since)
    .order("received_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`outreach_replies: ${error.message}`);
  const rows = (replies as { prospect_id: string; label: string; received_at: string }[] | null) ?? [];
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.prospect_id))];
  const [{ data: ps }, { data: evs }] = await Promise.all([
    db.from("outreach_prospects").select("id, business_name, domain, suburb, lane_id, test").in("id", ids),
    db.from("outreach_events").select("prospect_id, at, detail").in("prospect_id", ids).eq("kind", "checked"),
  ]);
  const prospects = new Map(((ps as { id: string; business_name: string | null; domain: string | null; suburb: string | null; lane_id: number | null; test: boolean }[] | null) ?? []).map((p) => [p.id, p]));
  const searched = ((evs as Ev[] | null) ?? []).filter((e) => e.detail?.competitors);
  const out: ReviewWaiting[] = [];
  for (const id of ids) {
    const p = prospects.get(id);
    if (!p || p.test || !p.domain) continue;
    const reply = rows.find((r) => r.prospect_id === id)!;
    if (searched.some((e) => e.prospect_id === id && e.at >= reply.received_at)) continue;
    out.push({ prospectId: id, businessName: p.business_name, domain: p.domain, suburb: p.suburb, laneId: p.lane_id, label: reply.label, repliedAt: reply.received_at });
  }
  return out;
}

/** The newest competitor search on record for a business, or null. */
export async function competitorCheckFor(db: SupabaseClient, prospectId: string): Promise<CompetitorCheck | null> {
  const { data } = await db.from("outreach_events").select("prospect_id, at, detail").eq("prospect_id", prospectId).eq("kind", "checked").order("at", { ascending: false }).limit(40);
  return ((data as Ev[] | null) ?? []).find((e) => e.detail?.competitors)?.detail?.competitors ?? null;
}

/**
 * May the review name this business? Never one of Kyle's clients or leads,
 * anyone on do-not-contact or his private exclusions. "unknown" when the
 * check couldn't run: then nobody is named. Only the answer comes back.
 */
export async function mayName(db: SupabaseClient, domain: string, name: string): Promise<"yes" | "no" | "unknown"> {
  const v = await checkBusiness(db, { domain, name });
  if (v.problem) return "unknown";
  const never = new Set(["client", "lead", "do_not_contact", "exclusion"]);
  const neverPrints = new Set(["a current or past client", "asked not to be contacted", "Opted out"]);
  return v.blocks.some((b) => never.has(b.source) || (b.source === "fingerprint" && neverPrints.has(b.label))) ? "no" : "yes";
}
