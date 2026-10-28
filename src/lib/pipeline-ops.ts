import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { businessToday } from "@/lib/business-time";
import { addDays, isLeadSource, isLeadStage, type ActivityKind, type Lead, type LeadStage } from "@/lib/pipeline-shared";
import { onDoNotContact } from "@/lib/pipeline";

/**
 * What can be done to a lead, once, for both ways in: the portal's buttons
 * (`src/app/admin/pipeline/actions.ts`, behind a Clerk admin session) and
 * Claude's connector (`src/lib/mcp/pipeline-tools.ts`, behind an OAuth token
 * issued to an admin). The caller has already checked who is asking; these
 * only do the work, so the two can never disagree about what a move means.
 *
 * `actor` goes in `created_by`: a Clerk user id from the portal, "claude"
 * from the connector.
 */

export type OpResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export interface LeadInput {
  name?: string;
  business?: string;
  email?: string;
  phone?: string;
  website?: string;
  source?: string;
  service?: string;
  value?: string | number | null;
  next_action?: string;
  follow_up_on?: string | null;
  notes?: string;
}

export function missingTable(err: { code?: string; message: string }): string {
  return err.code === "PGRST205" || err.code === "42P01" ? "Run migration 0056 in the Supabase SQL Editor first." : err.message;
}

/** Only fields that were passed are written, so an edit to one never blanks another. */
export function leadFields(input: LeadInput): Partial<Lead> {
  const out: Record<string, unknown> = {};
  const text = (v: string | undefined, max: number) => (v === undefined ? undefined : v.trim().slice(0, max) || null);
  for (const [k, max] of [
    ["name", 120],
    ["business", 160],
    ["email", 200],
    ["phone", 40],
    ["website", 300],
    ["service", 300],
    ["next_action", 300],
    ["notes", 8000],
  ] as const) {
    const v = text(input[k], max);
    if (v !== undefined) out[k] = v;
  }
  if (input.source !== undefined) out.source = isLeadSource(input.source) ? input.source : "manual";
  if (input.value !== undefined) {
    const n = input.value === null || input.value === "" ? null : Number(String(input.value).replace(/[$,\s]/g, ""));
    out.value = n === null || Number.isFinite(n) ? n : null;
  }
  if (input.follow_up_on !== undefined) {
    out.follow_up_on = input.follow_up_on && /^\d{4}-\d{2}-\d{2}$/.test(input.follow_up_on) ? input.follow_up_on : null;
  }
  return out as Partial<Lead>;
}

export async function logActivityRow(supabase: SupabaseClient, leadId: string, kind: ActivityKind, body: string | null, actor: string) {
  await supabase.from("lead_activity").insert({ lead_id: leadId, kind, body, created_by: actor });
}

/** A new lead, followed up tomorrow unless a date is given. */
export async function createLeadOp(
  supabase: SupabaseClient,
  actor: string,
  input: LeadInput,
  createdNote?: string,
): Promise<OpResult<{ id: string; warning: string | null }>> {
  const f = leadFields(input);
  if (!f.business && !f.name && !f.email) return { ok: false, message: "Give it at least a name, a business or an email." };
  if (f.follow_up_on === undefined) f.follow_up_on = addDays(businessToday(), 1);
  const { data, error } = await supabase
    .from("leads")
    .insert({ ...f, created_by: actor })
    .select("id")
    .single();
  if (error) return { ok: false, message: missingTable(error) };
  const id = (data as { id: string }).id;
  await logActivityRow(supabase, id, "created", createdNote ?? (input.notes?.trim() || null), actor);
  const dnc = f.email ? await onDoNotContact(supabase, f.email) : null;
  return {
    ok: true,
    id,
    warning: dnc ? `${f.email} is on your do-not-contact list (${dnc.reason.toLowerCase()}). Don't write to them unless they wrote to you first.` : null,
  };
}

export async function updateLeadOp(supabase: SupabaseClient, id: string, input: LeadInput): Promise<OpResult> {
  const { data, error } = await supabase.from("leads").update(leadFields(input)).eq("id", id).select("id");
  if (error) return { ok: false, message: missingTable(error) };
  if (Array.isArray(data) && data.length === 0) return { ok: false, message: "That lead no longer exists." };
  return { ok: true };
}

/** Move along the board. Won goes through `onboardLead` instead, so a won lead always has a client. */
export async function moveLeadOp(
  supabase: SupabaseClient,
  actor: string,
  id: string,
  stage: LeadStage,
  reason?: string,
): Promise<OpResult> {
  if (!isLeadStage(stage) || stage === "won") return { ok: false, message: "Use Won on the lead to onboard them." };
  const { data } = await supabase.from("leads").select("stage").eq("id", id).maybeSingle();
  const before = (data as { stage: LeadStage } | null)?.stage;
  if (!before) return { ok: false, message: "That lead no longer exists." };
  if (before === stage) return { ok: true };
  const patch: Record<string, unknown> = { stage, stage_changed_at: new Date().toISOString() };
  if (stage === "lost") {
    patch.lost_reason = reason?.trim().slice(0, 300) || null;
    patch.follow_up_on = null;
  }
  const { error } = await supabase.from("leads").update(patch).eq("id", id);
  if (error) return { ok: false, message: error.message };
  await logActivityRow(
    supabase,
    id,
    stage === "lost" ? "lost" : "stage",
    stage === "lost" ? reason?.trim() || null : `${before} → ${stage}`,
    actor,
  );
  return { ok: true };
}

export async function logActivityOp(
  supabase: SupabaseClient,
  actor: string,
  id: string,
  kind: "note" | "call" | "email" | "meeting",
  body: string,
): Promise<OpResult> {
  const text = body.trim().slice(0, 4000);
  if (!text) return { ok: false, message: "Write a line about it first." };
  const { data } = await supabase.from("leads").select("stage").eq("id", id).maybeSingle();
  const stage = (data as { stage: LeadStage } | null)?.stage;
  if (!stage) return { ok: false, message: "That lead no longer exists." };
  const { error } = await supabase.from("lead_activity").insert({ lead_id: id, kind, body: text, created_by: actor });
  if (error) return { ok: false, message: error.message };
  // Contact made moves a new lead on, which is nearly always what happened.
  if (kind !== "note" && stage === "new") {
    await supabase.from("leads").update({ stage: "contacted", stage_changed_at: new Date().toISOString() }).eq("id", id);
  }
  await supabase.from("leads").update({ updated_at: new Date().toISOString() }).eq("id", id);
  return { ok: true };
}
