import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CrmContact,
  CrmGrant,
  CrmList,
  CrmMetrics,
  CrmOrganisation,
  CrmResearch,
  CrmSettings,
  CrmTask,
  CrmTouch,
} from "@/lib/types/database";

/**
 * CRM queries. Every one takes the caller's Supabase client so RLS applies:
 * the crm_* tables are admin-only, so a client's session simply sees nothing.
 */

export interface ProspectRow {
  id: string;
  list_id: string | null;
  legal_name: string;
  state: string | null;
  tier: string | null;
  grant_total_aud: number;
  grant_count: number;
  grant_streams: string[];
  headline_purpose: string | null;
  stage: string;
  last_verified_at: string | null;
  contact_name: string | null;
  has_contact: boolean;
  opted_out: boolean;
  emails_sent: number;
  last_touch_at: string | null;
}

/** The prospect list: one row per organisation with its outreach state folded in. */
export async function listProspects(
  supabase: SupabaseClient,
  brand = "ironpeak",
): Promise<ProspectRow[]> {
  const [{ data: orgData }, { data: contactData }, { data: touchData }] =
    await Promise.all([
      supabase
        .from("crm_organisations")
        .select("*")
        .eq("brand", brand)
        .order("tier", { ascending: true })
        .order("grant_total_aud", { ascending: false }),
      supabase
        .from("crm_contacts")
        .select("organisation_id, first_name, surname, opt_out_at"),
      supabase
        .from("crm_touches")
        .select("organisation_id, channel, direction, sent_at"),
    ]);

  const orgs = (orgData as CrmOrganisation[] | null) ?? [];
  const contacts =
    (contactData as Pick<
      CrmContact,
      "organisation_id" | "first_name" | "surname" | "opt_out_at"
    >[] | null) ?? [];
  const touches =
    (touchData as Pick<
      CrmTouch,
      "organisation_id" | "channel" | "direction" | "sent_at"
    >[] | null) ?? [];

  const byOrg = new Map(contacts.map((c) => [c.organisation_id, c]));
  const sent = new Map<string, number>();
  const last = new Map<string, string>();
  for (const t of touches) {
    if (t.direction === "out" && t.channel === "email") {
      sent.set(t.organisation_id, (sent.get(t.organisation_id) ?? 0) + 1);
    }
    const prev = last.get(t.organisation_id);
    if (!prev || t.sent_at > prev) last.set(t.organisation_id, t.sent_at);
  }

  return orgs.map((o) => {
    const c = byOrg.get(o.id);
    const name = [c?.first_name, c?.surname].filter(Boolean).join(" ");
    return {
      id: o.id,
      list_id: o.list_id,
      legal_name: o.legal_name,
      state: o.state,
      tier: o.tier,
      grant_total_aud: Number(o.grant_total_aud),
      grant_count: o.grant_count,
      grant_streams: o.grant_streams,
      headline_purpose: o.headline_purpose,
      stage: o.stage,
      last_verified_at: o.last_verified_at,
      contact_name: name || null,
      has_contact: !!c,
      opted_out: !!c?.opt_out_at,
      emails_sent: sent.get(o.id) ?? 0,
      last_touch_at: last.get(o.id) ?? null,
    };
  });
}

export interface ProspectDetail {
  organisation: CrmOrganisation;
  grants: CrmGrant[];
  contact: CrmContact | null;
  research: CrmResearch | null;
  touches: CrmTouch[];
  tasks: CrmTask[];
}

export async function getProspect(
  supabase: SupabaseClient,
  id: string,
): Promise<ProspectDetail | null> {
  const { data: orgData } = await supabase
    .from("crm_organisations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const organisation = orgData as CrmOrganisation | null;
  if (!organisation) return null;

  const [
    { data: grantData },
    { data: contactData },
    { data: researchData },
    { data: touchData },
    { data: taskData },
  ] = await Promise.all([
    supabase
      .from("crm_grants")
      .select("*")
      .eq("organisation_id", id)
      .order("amount", { ascending: false }),
    supabase.from("crm_contacts").select("*").eq("organisation_id", id).maybeSingle(),
    supabase.from("crm_research").select("*").eq("organisation_id", id).maybeSingle(),
    supabase
      .from("crm_touches")
      .select("*")
      .eq("organisation_id", id)
      .order("sent_at", { ascending: false }),
    supabase
      .from("crm_tasks")
      .select("*")
      .eq("organisation_id", id)
      .is("done_at", null)
      .order("due_on"),
  ]);

  return {
    organisation,
    grants: (grantData as CrmGrant[] | null) ?? [],
    contact: (contactData as CrmContact | null) ?? null,
    research: (researchData as CrmResearch | null) ?? null,
    touches: (touchData as CrmTouch[] | null) ?? [],
    tasks: (taskData as CrmTask[] | null) ?? [],
  };
}

export async function getCrmMetrics(
  supabase: SupabaseClient,
  days = 7,
  brand = "ironpeak",
): Promise<CrmMetrics> {
  const { data } = await supabase.rpc("crm_metrics", {
    p_days: days,
    p_brand: brand,
  });
  const row = (data as CrmMetrics[] | null)?.[0];
  return (
    row ?? {
      sent: 0,
      replies: 0,
      substantive: 0,
      opt_outs: 0,
      sent_today: 0,
      live_engagements: 0,
      sends_since_substantive: 0,
    }
  );
}

export async function getCrmSettings(
  supabase: SupabaseClient,
): Promise<CrmSettings | null> {
  const { data } = await supabase.from("crm_settings").select("*").maybeSingle();
  return (data as CrmSettings | null) ?? null;
}

export interface DueTask extends CrmTask {
  organisation_name: string | null;
}

/** Open tasks due on or before today, soonest first. Drives the reminder list. */
export async function listDueTasks(
  supabase: SupabaseClient,
  onOrBefore: string,
): Promise<DueTask[]> {
  const { data } = await supabase
    .from("crm_tasks")
    .select("*, crm_organisations(legal_name)")
    .is("done_at", null)
    .lte("due_on", onOrBefore)
    .order("due_on");
  const rows =
    (data as (CrmTask & { crm_organisations: { legal_name: string } | null })[] | null) ??
    [];
  return rows.map((r) => ({
    ...r,
    organisation_name: r.crm_organisations?.legal_name ?? null,
  }));
}

/** Source lists, newest first, with how many prospects each holds. */
export async function listCrmLists(
  supabase: SupabaseClient,
  brand = "ironpeak",
): Promise<(CrmList & { count: number })[]> {
  const [{ data: listData }, { data: orgData }] = await Promise.all([
    supabase.from("crm_lists").select("*").eq("brand", brand).order("created_at"),
    supabase.from("crm_organisations").select("list_id").eq("brand", brand),
  ]);
  const lists = (listData as CrmList[] | null) ?? [];
  const counts = new Map<string, number>();
  for (const o of ((orgData as { list_id: string | null }[] | null) ?? [])) {
    if (o.list_id) counts.set(o.list_id, (counts.get(o.list_id) ?? 0) + 1);
  }
  return lists.map((l) => ({ ...l, count: counts.get(l.id) ?? 0 }));
}

/** Counts per pipeline stage, for the summary strip. */
export function stageCounts(rows: ProspectRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.stage] = (out[r.stage] ?? 0) + 1;
  return out;
}
