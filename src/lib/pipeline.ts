import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, LeadActivity } from "@/lib/pipeline-shared";

function isMissingTable(err: { code?: string } | null | undefined): boolean {
  return !!err && (err.code === "PGRST205" || err.code === "42P01");
}

export async function listLeads(supabase: SupabaseClient): Promise<{ leads: Lead[]; missing: boolean }> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("follow_up_on", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false });
  if (isMissingTable(error)) return { leads: [], missing: true };
  if (error) throw new Error(`Could not read the pipeline: ${error.message}`);
  return { leads: (data as Lead[] | null) ?? [], missing: false };
}

export async function getLead(
  supabase: SupabaseClient,
  id: string,
): Promise<{ lead: Lead; activity: LeadActivity[]; doNotContact: { reason: string; recorded_at: string } | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [{ data: lead }, { data: activity }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    supabase.from("lead_activity").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
  ]);
  if (!lead) return null;
  const l = lead as Lead;
  return {
    lead: l,
    activity: (activity as LeadActivity[] | null) ?? [],
    doNotContact: l.email ? await onDoNotContact(supabase, l.email) : null,
  };
}

/**
 * Is this address on the do-not-contact list? Checked when a lead is added and
 * shown on the lead, because the list exists so that nobody who said no is
 * ever written to again, and that only works if it is looked at.
 */
export async function onDoNotContact(
  supabase: SupabaseClient,
  email: string,
): Promise<{ reason: string; recorded_at: string } | null> {
  const { data } = await supabase
    .from("do_not_contact")
    .select("reason, recorded_at")
    .eq("email_lower", email.trim().toLowerCase())
    .maybeSingle();
  return (data as { reason: string; recorded_at: string } | null) ?? null;
}
