"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { FOLLOW_UP_DAYS } from "@/lib/crm-shared";

/**
 * CRM actions. The crm_* tables carry an admin-only RLS policy, so these use
 * the caller's own Supabase client and let the database do the authorising as
 * well. The service role is deliberately not used: nothing here needs to cross
 * a tenancy boundary.
 */
async function adminSupabase() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return { supabase: await createServerSupabase(), session };
}

/** Local ISO date, N days from today. Never toISOString, which would be UTC. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface SaveContactInput {
  firstName: string;
  surname: string;
  roleTitle: string;
  roleSource: string;
  roleConfirmed: boolean;
  emailAsPublished: string;
  emailSourceUrl: string;
  emailVerifiedAt: string; // ISO date
  linkedinUrl: string;
  screenshotPath: string;
  noOptOutNotice: boolean;
  consentBasis: string;
  relevanceNote: string;
}

/**
 * Create or update the single contact for an organisation. The published email
 * is written through untouched: no trim, no lowercasing. The exact string as
 * published is the evidence that inferred consent attaches to it, so
 * normalising it would quietly destroy the only thing that makes it useful.
 */
export async function saveContact(
  organisationId: string,
  input: SaveContactInput,
) {
  const { supabase } = await adminSupabase();

  const row = {
    organisation_id: organisationId,
    first_name: input.firstName.trim() || null,
    surname: input.surname.trim() || null,
    role_title: input.roleTitle.trim() || null,
    role_source: input.roleSource || null,
    role_confirmed: input.roleConfirmed,
    email_as_published: input.emailAsPublished || null,
    email_source_url: input.emailSourceUrl.trim() || null,
    email_verified_at: input.emailVerifiedAt || null,
    linkedin_url: input.linkedinUrl.trim() || null,
    screenshot_path: input.screenshotPath.trim() || null,
    no_opt_out_notice: input.noOptOutNotice,
    consent_basis: input.consentBasis,
    relevance_note: input.relevanceNote.trim() || null,
  };

  const { data: existing } = await supabase
    .from("crm_contacts")
    .select("id")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("crm_contacts")
      .update(row)
      .eq("id", (existing as { id: string }).id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("crm_contacts").insert(row);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/admin/crm/${organisationId}`);
}

export interface SaveResearchInput {
  verifiedOn: string;
  leadFinding: string;
  leadFindingMethod: string;
  technicalDomainFinding: string;
  positiveFinding: string;
  keepOutOfFirstEmail: string;
  blocker: string;
}

/**
 * Save the note. The technical domain finding and the positive finding are the
 * two that gate a first email, so the form marks them as required and the
 * database refuses the send without them.
 */
export async function saveResearch(
  organisationId: string,
  input: SaveResearchInput,
) {
  const { supabase } = await adminSupabase();
  const row = {
    organisation_id: organisationId,
    verified_on: input.verifiedOn || null,
    lead_finding: input.leadFinding.trim() || null,
    lead_finding_method: input.leadFindingMethod.trim() || null,
    technical_domain_finding: input.technicalDomainFinding.trim() || null,
    positive_finding: input.positiveFinding.trim() || null,
    keep_out_of_first_email: input.keepOutOfFirstEmail.trim() || null,
    blocker: input.blocker.trim() || null,
  };

  const { data: existing } = await supabase
    .from("crm_research")
    .select("id")
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("crm_research")
      .update(row)
      .eq("id", (existing as { id: string }).id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("crm_research").insert(row);
    if (error) throw new Error(error.message);
  }

  // Research done and evidenced moves it out of the raw grant list.
  await supabase
    .from("crm_organisations")
    .update({ last_verified_at: new Date().toISOString() })
    .eq("id", organisationId)
    .eq("stage", "researched");

  revalidatePath(`/admin/crm/${organisationId}`);
}

export interface LogTouchInput {
  organisationId: string;
  contactId: string;
  channel: string;
  sequenceStep: string;
  subject: string;
  bodySnapshot: string;
  presendChecks: Record<string, boolean>;
}

/**
 * Record something that was actually sent. Kyle sends from Outlook, so this is
 * the log rather than the send, but every guard still applies: the database
 * refuses an outbound email when the consent trail is incomplete, when the
 * contact has opted out, when the note has no technical finding, or when the
 * nine pre-send checks are not all ticked.
 *
 * Logging email 1 also books the two things that otherwise get forgotten: the
 * LinkedIn request a day later, and email 2 at day 8 to 10.
 */
export async function logTouch(input: LogTouchInput) {
  const { supabase } = await adminSupabase();

  const { error } = await supabase.from("crm_touches").insert({
    contact_id: input.contactId,
    organisation_id: input.organisationId,
    channel: input.channel,
    sequence_step: input.sequenceStep,
    direction: "out",
    subject: input.subject.trim() || null,
    body_snapshot: input.bodySnapshot.trim() || null,
    presend_checks: input.presendChecks,
  });
  if (error) throw new Error(error.message);

  const stageFor: Record<string, string> = {
    email_1: "contacted",
    linkedin_connect: "connected",
    email_2: "followed_up",
  };
  const nextStage = stageFor[input.sequenceStep];
  if (nextStage) {
    await supabase
      .from("crm_organisations")
      .update({ stage: nextStage })
      .eq("id", input.organisationId);
  }

  if (input.sequenceStep === "email_1") {
    await supabase.from("crm_tasks").insert([
      {
        organisation_id: input.organisationId,
        contact_id: input.contactId,
        kind: "linkedin_connect",
        title: "Send the LinkedIn connection request, no pitch",
        due_on: isoDaysFromNow(1),
      },
      {
        organisation_id: input.organisationId,
        contact_id: input.contactId,
        kind: "follow_up",
        title: "Email 2, then stop",
        due_on: isoDaysFromNow(FOLLOW_UP_DAYS),
      },
    ]);
  }

  // Close whatever task this send was satisfying.
  if (input.sequenceStep === "linkedin_connect" || input.sequenceStep === "email_2") {
    const kind = input.sequenceStep === "email_2" ? "follow_up" : "linkedin_connect";
    await supabase
      .from("crm_tasks")
      .update({ done_at: new Date().toISOString() })
      .eq("organisation_id", input.organisationId)
      .eq("kind", kind)
      .is("done_at", null);
  }

  revalidatePath(`/admin/crm/${input.organisationId}`);
  revalidatePath("/admin/crm");
}

/**
 * Record a reply. A negative reply, bounce or opt-out trips a database trigger
 * that sets the organisation to do not contact, stamps the opt-out and closes
 * every outstanding task, permanently.
 */
export async function logReply(
  organisationId: string,
  contactId: string,
  outcome: string,
  substantive: boolean,
  bodySnapshot: string,
) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase.from("crm_touches").insert({
    contact_id: contactId,
    organisation_id: organisationId,
    channel: "reply",
    sequence_step: "inbound",
    direction: "in",
    outcome,
    substantive,
    body_snapshot: bodySnapshot.trim() || null,
  });
  if (error) throw new Error(error.message);

  const stopping = ["reply_negative", "bounce", "opt_out"].includes(outcome);
  if (!stopping) {
    await supabase
      .from("crm_organisations")
      .update({ stage: "replied" })
      .eq("id", organisationId)
      .in("stage", ["contacted", "connected", "followed_up"]);
  }
  if (outcome === "opt_out") {
    // The Spam Act gives five working days to action an opt-out, and the date
    // actioned has to be logged.
    await supabase.from("crm_tasks").insert({
      organisation_id: organisationId,
      contact_id: contactId,
      kind: "manual",
      title: "Action the opt-out and record the date, within five working days",
      due_on: isoDaysFromNow(3),
    });
  }

  revalidatePath(`/admin/crm/${organisationId}`);
  revalidatePath("/admin/crm");
}

/** Confirm an opt-out has been actioned, which is the part that must be logged. */
export async function markOptOutActioned(contactId: string, organisationId: string) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_contacts")
    .update({ opt_out_actioned_at: new Date().toISOString() })
    .eq("id", contactId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/crm/${organisationId}`);
}

export async function setStage(organisationId: string, stage: string) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_organisations")
    .update({ stage })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm");
  revalidatePath(`/admin/crm/${organisationId}`);
}

export async function completeTask(taskId: string) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_tasks")
    .update({ done_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm");
}

export async function addNote(organisationId: string, body: string) {
  const { supabase, session } = await adminSupabase();
  const text = body.trim();
  if (!text) return;
  const { error } = await supabase.from("crm_notes").insert({
    organisation_id: organisationId,
    body: text,
    author_user_id: session.clerkUserId,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/crm/${organisationId}`);
}

export async function saveCrmGoals(daily: number, weekly: number) {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_settings")
    .update({
      daily_contact_goal: Math.max(0, Math.floor(daily)),
      weekly_contact_goal: Math.max(0, Math.floor(weekly)),
    })
    .eq("id", true);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm");
}
