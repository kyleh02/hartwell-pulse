"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { businessToday } from "@/lib/business-time";
import {
  addDays,
  isLeadSource,
  isLeadStage,
  leadTitle,
  type ActivityKind,
  type Lead,
  type LeadStage,
} from "@/lib/pipeline-shared";
import { onDoNotContact } from "@/lib/pipeline";
import { provisionClient, signInLink } from "@/lib/provision";
import { welcomeEmail } from "@/lib/welcome-emails";
import { sendEmail } from "@/lib/email";
import { HARTWELL } from "@/lib/brand";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function admin() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return { session, supabase: await createServerSupabase() };
}

function missing(err: { code?: string; message: string }): string {
  return err.code === "PGRST205" || err.code === "42P01" ? "Run migration 0056 in the Supabase SQL Editor first." : err.message;
}

function refresh(id?: string) {
  revalidatePath("/admin/pipeline");
  if (id) revalidatePath(`/admin/pipeline/${id}`);
  revalidatePath("/admin");
}

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

/** Only fields that were passed are written, so an edit to one never blanks another. */
function fields(input: LeadInput): Partial<Lead> {
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

async function log(supabase: Awaited<ReturnType<typeof createServerSupabase>>, leadId: string, kind: ActivityKind, body: string | null, by: string) {
  await supabase.from("lead_activity").insert({ lead_id: leadId, kind, body, created_by: by });
}

/** A new lead, followed up tomorrow unless a date is given. */
export async function createLead(input: LeadInput): Promise<Result<{ id: string; warning: string | null }>> {
  const { session, supabase } = await admin();
  const f = fields(input);
  if (!f.business && !f.name && !f.email) return { ok: false, message: "Give it at least a name, a business or an email." };
  if (f.follow_up_on === undefined) f.follow_up_on = addDays(businessToday(), 1);
  const { data, error } = await supabase
    .from("leads")
    .insert({ ...f, created_by: session.clerkUserId })
    .select("id")
    .single();
  if (error) return { ok: false, message: missing(error) };
  const id = (data as { id: string }).id;
  await log(supabase, id, "created", input.notes?.trim() || null, session.clerkUserId);
  const dnc = f.email ? await onDoNotContact(supabase, f.email) : null;
  refresh(id);
  return {
    ok: true,
    id,
    warning: dnc ? `${f.email} is on your do-not-contact list (${dnc.reason.toLowerCase()}). Don't write to them unless they wrote to you first.` : null,
  };
}

export async function updateLead(id: string, input: LeadInput): Promise<Result> {
  const { supabase } = await admin();
  const { error } = await supabase.from("leads").update(fields(input)).eq("id", id);
  if (error) return { ok: false, message: missing(error) };
  refresh(id);
  return { ok: true };
}

/** Move along the board. Won goes through `onboardLead` instead. */
export async function moveLead(id: string, stage: LeadStage, reason?: string): Promise<Result> {
  const { session, supabase } = await admin();
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
  await log(
    supabase,
    id,
    stage === "lost" ? "lost" : "stage",
    stage === "lost" ? reason?.trim() || null : `${before} → ${stage}`,
    session.clerkUserId,
  );
  refresh(id);
  return { ok: true };
}

export async function logLeadActivity(id: string, kind: "note" | "call" | "email" | "meeting", body: string): Promise<Result> {
  const { session, supabase } = await admin();
  const text = body.trim().slice(0, 4000);
  if (!text) return { ok: false, message: "Write a line about it first." };
  const { error } = await supabase.from("lead_activity").insert({ lead_id: id, kind, body: text, created_by: session.clerkUserId });
  if (error) return { ok: false, message: error.message };
  // Contact made moves a new lead on, which is nearly always what happened.
  if (kind !== "note") {
    const { data } = await supabase.from("leads").select("stage").eq("id", id).maybeSingle();
    if ((data as { stage: LeadStage } | null)?.stage === "new") {
      await supabase.from("leads").update({ stage: "contacted", stage_changed_at: new Date().toISOString() }).eq("id", id);
    }
  }
  await supabase.from("leads").update({ updated_at: new Date().toISOString() }).eq("id", id);
  refresh(id);
  return { ok: true };
}

export async function deleteLead(id: string): Promise<Result> {
  const { supabase } = await admin();
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// They said yes
// ---------------------------------------------------------------------------

export interface OnboardInput {
  businessName: string;
  contactName: string;
  email: string;
  serviceTier: string;
}

export interface OnboardResult {
  clientId: string;
  emailedTo: string | null;
  linkSent: boolean;
  /** Only when the login could not be made without one: show it to Kyle once. */
  tempPassword: string | null;
  steps: string[];
}

/**
 * Won: turn a lead into a client in one go, and make the first impression.
 *
 * 1. Their portal and login (no password: they sign in from a link).
 * 2. Their onboarding, started, so Home says "Start here".
 * 3. A welcome email from Kyle with a one-click sign-in button.
 * 4. A welcome message from Kyle waiting in their portal chat.
 * 5. Check-in emails on day 3 and day 7, sent by the email job.
 * 6. The lead marked won and linked to the client.
 *
 * Step 1 is the only one that can stop it. Everything after is best effort and
 * reported back step by step, because a won client with a missed email is
 * still a won client, and Kyle needs to know which email to send by hand.
 */
export async function onboardLead(leadId: string, input: OnboardInput): Promise<Result<OnboardResult>> {
  const { session, supabase } = await admin();
  const { data: leadRow } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
  const lead = leadRow as Lead | null;
  if (!lead) return { ok: false, message: "That lead no longer exists." };
  if (lead.stage === "won" && lead.client_id) return { ok: false, message: "This lead is already a client." };

  let made;
  try {
    made = await provisionClient({ ...input, passwordless: true });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not create their portal." };
  }

  const svc = createAdminSupabase();
  const origin = (process.env.NEXT_PUBLIC_APP_URL || `https://${HARTWELL.site}`).replace(/\/$/, "");
  const first = input.contactName.trim().split(/\s+/)[0] || "there";
  const steps: string[] = [`Created ${input.businessName.trim()}'s portal and login`];

  // 2. onboarding, started
  const { error: obErr } = await svc.from("onboarding").insert({ client_id: made.clientId });
  if (!obErr) steps.push("Started their onboarding");

  // 3. the welcome email
  const link = made.password ? null : await signInLink(made.userId, origin);
  const mail = welcomeEmail({ origin, first, business: input.businessName.trim(), link });
  const sent = await sendEmail({ to: made.email, subject: mail.subject, html: mail.html, ref: { kind: "other", id: made.clientId } });
  const emailed = !sent.error && !sent.skipped;
  steps.push(emailed ? `Emailed a welcome to ${made.email}${link ? " with a one-click sign-in button" : ""}` : `The welcome email did NOT send${sent.error ? ` (${sent.error})` : ""}. Send their login by hand.`);

  // 4. a welcome in their chat, from Kyle. The chat's own notification is
  // marked emailed, so it does not arrive as a second email on day one.
  const { data: conv } = await svc
    .from("conversations")
    .select("id")
    .eq("client_id", made.clientId)
    .eq("kind", "direct")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (conv) {
    const { error: mErr } = await svc.from("messages").insert({
      conversation_id: (conv as { id: string }).id,
      client_id: made.clientId,
      sender_user_id: session.clerkUserId,
      sender_role: "admin",
      body: `Hi ${first}, welcome aboard! This chat comes straight to me, so ask anything, any time. Your first job is the short page about your business: tap Start here on your Home. Looking forward to this.`,
    });
    if (!mErr) {
      steps.push("Left a welcome message in their portal chat");
      await svc
        .from("notifications")
        .update({ emailed_at: new Date().toISOString() })
        .eq("client_id", made.clientId)
        .eq("type", "message")
        .is("emailed_at", null);
    }
  }

  // 5. the check-ins
  const now = Date.now();
  const { error: sErr } = await svc.from("scheduled_emails").insert([
    { client_id: made.clientId, recipient_user_id: made.userId, to_email: made.email, kind: "welcome_day3", send_after: new Date(now + 3 * 86_400_000).toISOString() },
    { client_id: made.clientId, recipient_user_id: made.userId, to_email: made.email, kind: "welcome_day7", send_after: new Date(now + 7 * 86_400_000).toISOString() },
  ]);
  if (!sErr) steps.push("Booked check-in emails for day 3 and day 7");

  // 6. the lead
  await supabase
    .from("leads")
    .update({ stage: "won", won_at: new Date().toISOString(), client_id: made.clientId, follow_up_on: null, stage_changed_at: new Date().toISOString() })
    .eq("id", leadId);
  await log(supabase, leadId, "won", `Onboarded as ${input.businessName.trim()}`, session.clerkUserId);

  refresh(leadId);
  revalidatePath("/admin/clients");
  return {
    ok: true,
    clientId: made.clientId,
    emailedTo: emailed ? made.email : null,
    linkSent: emailed && !!link,
    tempPassword: made.password,
    steps,
  };
}

/** For the Won dialog: what to fill in, from the lead. */
export async function onboardDefaults(leadId: string): Promise<OnboardInput | null> {
  const { supabase } = await admin();
  const { data } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
  const l = data as Lead | null;
  if (!l) return null;
  return { businessName: l.business ?? leadTitle(l), contactName: l.name ?? "", email: l.email ?? "", serviceTier: "growth" };
}
