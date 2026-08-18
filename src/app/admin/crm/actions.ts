"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { FOLLOW_UP_DAYS } from "@/lib/crm-shared";
import { PIPELINE_V2 } from "@/lib/crm-pipeline-v2";
import { draftOutreach, confirmSent } from "@/lib/crm-send";

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
  directEmail: string;
  phone: string;
  linkedinUrl: string;
  screenshotPath: string;
  noOptOutNotice: boolean;
  consentBasis: string;
  relevanceNote: string;
}

/**
 * Create a source list. Where a prospect came from is what makes a first email
 * specific, so a new batch of names gets its own list rather than being poured
 * into the grant recipients.
 */
export async function createList(input: {
  name: string;
  description: string;
  sourceNote: string;
  capturedOn: string;
  brand: string;
}): Promise<string> {
  const { supabase } = await adminSupabase();
  const name = input.name.trim();
  if (!name) throw new Error("Give the list a name.");

  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "list";
  let slug = base;
  for (let n = 2; n < 100; n++) {
    const { data: clash } = await supabase
      .from("crm_lists")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  const { data, error } = await supabase
    .from("crm_lists")
    .insert({
      brand: input.brand,
      slug,
      name,
      description: input.description.trim() || null,
      source_note: input.sourceNote.trim() || null,
      captured_on: input.capturedOn || null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the list.");
  revalidatePath("/admin/crm");
  return (data as { id: string }).id;
}

/**
 * Add a company to a list by hand, for prospects that did not arrive in a
 * batch. It starts at researched like everything else: nothing has been
 * verified against their site yet.
 */
export async function addProspect(input: {
  listId: string;
  legalName: string;
  state: string;
  websiteUrl: string;
  headlinePurpose: string;
  brand: string;
}): Promise<string> {
  const { supabase } = await adminSupabase();
  const legalName = input.legalName.trim();
  if (!legalName) throw new Error("Give the company a name.");

  const { data: clash } = await supabase
    .from("crm_organisations")
    .select("id")
    .eq("brand", input.brand)
    .ilike("legal_name", legalName)
    .maybeSingle();
  if (clash) throw new Error(`${legalName} is already in the pipeline.`);

  const { data, error } = await supabase
    .from("crm_organisations")
    .insert({
      brand: input.brand,
      list_id: input.listId,
      legal_name: legalName,
      state: input.state.trim() || null,
      website_url: input.websiteUrl.trim() || null,
      headline_purpose: input.headlinePurpose.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not add the company.");
  revalidatePath("/admin/crm");
  return (data as { id: string }).id;
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
    direct_email: input.directEmail.trim() || null,
    phone: input.phone.trim() || null,
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

/**
 * The seed importers and the master-list sync used to live here.
 *
 * Removed alongside the version 4 pipeline. They applied `crm-seed-data.ts`
 * and `crm-pipeline-master.ts`, the superseded 76 and 59 record datasets, so
 * pressing any of them would have resurrected the companies that were
 * deliberately triaged out, and re-attached capability-statement hooks to
 * records whose email now leads with a website fault. `replacePipeline` below
 * creates the companies it cannot find, so it bootstraps an empty pipeline on
 * its own and none of them was still needed.
 */

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

/**
 * Replace the whole Ironpeak pipeline with the 7 August 2026 handoff.
 *
 * REPLACE, not merge. The earlier datasets held 76 records of which 51 were
 * triaged out, and the offer was repositioned from capability statements to
 * websites, so almost every hook changed. Merging would leave ruled-out
 * companies sitting alongside live ones and old capability-statement hooks
 * attached to records whose email now leads with a website fault.
 *
 * The one thing not thrown away is the touch log. Fourteen of these companies
 * have already been emailed, and those sends are the Spam Act record. So a
 * company that already exists is UPDATED in place, keeping its id and
 * therefore its touches, and only companies absent from the new list are
 * deleted. A deleted company with a logged send is kept regardless: a
 * compliance record outranks a tidy list.
 */
export async function replacePipeline(): Promise<{
  updated: number;
  created: number;
  removed: number;
  keptWithHistory: number;
}> {
  const { supabase } = await adminSupabase();

  const { data: orgData, error: oErr } = await supabase
    .from("crm_organisations")
    .select("id, legal_name, stage")
    .eq("brand", "ironpeak");
  if (oErr) throw new Error(oErr.message);
  const existing =
    (orgData as { id: string; legal_name: string; stage: string }[] | null) ?? [];

  // Stages that mean contact has actually happened. The file is a plan and the
  // portal is the record of what was done, so the portal wins on these. Without
  // this, re-syncing after a send would reset that company to "queued" with its
  // email body restored, and the same email could go to the same person twice.
  const AHEAD = new Set([
    "contacted", "connected", "followed_up", "replied", "conversation",
    "proposal", "won", "delivered",
    "declined", "bounced", "stopped", "do_not_contact",
  ]);

  /**
   * True only when the PORTAL knows more than the file does.
   *
   * The first version of this asked "is the stored stage ahead?", which was too
   * blunt and blanked Coastal Aviation's outbox. Coastal is `contacted` in the
   * file too, because its first email went on 5 August, and the email the file
   * carries is the FOLLOW-UP. The file and the portal agree there, so there is
   * nothing to protect against.
   *
   * The case worth guarding is disagreement: the file still says `queued` while
   * the portal says `contacted`, which means the send happened since the file
   * was written and the email it carries is the one already in their inbox.
   * That is the one that must not be reloaded and approved a second time.
   */
  // When the FILE says bounced or email_closed it is reporting something the
  // portal cannot know: that a message was rejected, or that a mail server
  // refuses this sender. The file wins outright on those, or a record the
  // portal still thinks is "contacted" would keep that stage and have its
  // rewritten email cleared.
  const FILE_WINS = new Set(["bounced", "email_closed"]);
  const portalAhead = (stored: string | undefined, fromFile: string) =>
    Boolean(stored) &&
    !FILE_WINS.has(fromFile) &&
    AHEAD.has(stored!) &&
    !AHEAD.has(fromFile);
  const byName = new Map(existing.map((o) => [o.legal_name.toLowerCase(), o]));

  const keepNames = new Set(PIPELINE_V2.map((r) => r.company.toLowerCase()));

  let updated = 0;
  let created = 0;

  for (const row of PIPELINE_V2) {
    const org = byName.get(row.company.toLowerCase());
    const orgFields = {
      brand: "ironpeak",
      legal_name: row.company,
      state: row.state,
      domain: row.domain === "NO WEBSITE" ? null : row.domain,
      website_url:
        row.domain === "NO WEBSITE" ? null : `https://${row.domain}`,
      rank: row.rank,
      priority_tier: row.tier,
      channel: row.channel,
      stage: portalAhead(org?.stage, row.stage) ? org!.stage : row.stage,
      // sendImmediately means "on receipt, override the window", which is a
      // time already past rather than a special case for the sender to know
      // about. Coastal Aviation's compromised site is the only one.
      scheduled_send_at: portalAhead(org?.stage, row.stage)
        ? null
        : (row.scheduledSendAt ??
          (row.sendImmediately ? new Date().toISOString() : null)),
      followup_due: row.followupDue ?? null,
      hook: row.hook,
      hook_verified_at: row.hookVerified,
      pipeline_notes: row.notes,
      hard_warning: row.hardWarning ?? null,
      source_status: row.stage,
      email_subject: row.emailSubject,
      // Only a "ready" email is loaded into the outbox. "held" and
      // "not-written" records carry their blocker instead, so there is nothing
      // sitting there that could be approved by accident.
      email_body: portalAhead(org?.stage, row.stage)
        ? null
        : row.emailStatus === "ready"
          ? row.emailBody
          : null,
      // Replacing the data always clears approval. An email that changed is
      // not the email that was read and approved.
      send_approved_at: null,
      // And it clears the draft, for the same reason one step further on. The
      // cron treats a non-null draft_created_at as "this one is done", so a
      // record drafted under the old body would never be drafted again and the
      // rewritten email would sit approved and silently undraftable. Version 4
      // rewrote 16 bodies, so this is not a hypothetical. Any draft already in
      // the Outlook folder holds the OLD text and should be deleted there:
      // nothing here can reach into the mailbox to withdraw it.
      draft_created_at: null,
      graph_message_id: null,
      graph_web_link: null,
      send_error: row.emailBlocker,
      next_action:
        row.emailStatus === "ready"
          ? "Approve the email so it sends at its scheduled time"
          : row.emailBlocker ?? null,
    };

    let orgId: string;
    if (org) {
      const { error } = await supabase
        .from("crm_organisations")
        .update(orgFields)
        .eq("id", org.id);
      if (error) throw new Error(`${row.company}: ${error.message}`);
      orgId = org.id;
      updated++;
    } else {
      const { data: made, error } = await supabase
        .from("crm_organisations")
        .insert(orgFields)
        .select("id")
        .single();
      if (error || !made) {
        throw new Error(`${row.company}: ${error?.message ?? "insert failed"}`);
      }
      orgId = (made as { id: string }).id;
      created++;
    }

    // ---- the single contact ----
    const parts = row.contactName.trim().split(/\s+/);
    const contactFields = {
      first_name: parts[0] ?? null,
      surname: parts.length > 1 ? parts.slice(1).join(" ") : null,
      name_verified: row.nameVerified,
      fallback_greeting: row.fallbackGreeting ?? null,
      // Verbatim. Never trimmed or lowercased: the exact string as published
      // is the evidence.
      email_as_published: row.email,
      email_source_note: row.emailSourceNote,
      // Everything in this file was confirmed published on the company's own
      // site on 7 August 2026, with Tynbell the one exception, and Tynbell is
      // blocked so it cannot send anyway.
      email_verified_at: "2026-08-07T00:00:00+10:00",
      consent_basis: "inferred_published",
      relevance_note:
        row.channel === "DIDG"
          ? "Received a Defence Industry Development Grant."
          : "Named as a subcontractor in a public Australian Industry Capability plan on defence.gov.au.",
      is_sole_contact_for_org: true,
    };

    const { data: had } = await supabase
      .from("crm_contacts")
      .select("id")
      .eq("organisation_id", orgId)
      .maybeSingle();

    if (had) {
      const { error } = await supabase
        .from("crm_contacts")
        .update(contactFields)
        .eq("id", (had as { id: string }).id);
      if (error) throw new Error(`${row.company} contact: ${error.message}`);
    } else {
      const { error } = await supabase
        .from("crm_contacts")
        .insert({ organisation_id: orgId, ...contactFields });
      if (error) throw new Error(`${row.company} contact: ${error.message}`);
    }
  }

  // ---- remove everything the new list does not carry ----
  let removed = 0;
  let keptWithHistory = 0;

  for (const o of existing) {
    if (keepNames.has(o.legal_name.toLowerCase())) continue;
    const { count } = await supabase
      .from("crm_touches")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", o.id);
    if ((count ?? 0) > 0) {
      keptWithHistory++;
      await supabase
        .from("crm_organisations")
        .update({
          stage: "lost",
          lost_reason: "Not in the 7 August 2026 pipeline. Kept: has a logged send.",
        })
        .eq("id", o.id);
      continue;
    }
    const { error } = await supabase
      .from("crm_organisations")
      .delete()
      .eq("id", o.id);
    if (error) throw new Error(`Removing ${o.legal_name}: ${error.message}`);
    removed++;
  }

  revalidatePath("/admin/crm");
  return { updated, created, removed, keptWithHistory };
}

/**
 * Mark a queued record as drafted or scheduled in Outlook.
 *
 * Separate from logging the send, deliberately. Kyle writes and schedules
 * ahead of time and Outlook sends later, so one flag could only ever be a lie
 * in one direction: either claiming an email went out while it sits in a
 * drafts folder, or losing the work of having written it. Logging the actual
 * send stays the thing that advances the stage, counts toward the daily goal
 * and stands as the Spam Act record.
 */
export async function setScheduled(
  organisationId: string,
  scheduled: boolean,
): Promise<void> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_organisations")
    .update({ scheduled_at: scheduled ? new Date().toISOString() : null })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/plan");
}

/** The email that will go out, saved on the record. */
export async function saveOutreachEmail(
  organisationId: string,
  subject: string,
  body: string,
): Promise<void> {
  const { supabase } = await adminSupabase();
  // Editing the email un-approves it. Approval means "I read this and it may
  // go"; a body that changed afterwards was never the thing that was read.
  const { error } = await supabase
    .from("crm_organisations")
    .update({
      email_subject: subject.trim() || null,
      email_body: body.trim() || null,
      send_approved_at: null,
      send_error: null,
    })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/crm/${organisationId}`);
  revalidatePath("/admin/crm/plan");
}

export type ApproveResult =
  | { ok: true; scheduledFor: string | null }
  | { ok: false; message: string };

/**
 * Approve an email to be sent automatically at its scheduled time.
 *
 * The nine pre-send checks are ticked HERE, not at send time, because nobody
 * is at the keyboard at 8:47 in the morning. That is the honest place for them:
 * a checklist confirmed by a machine on a human's behalf is not a check.
 *
 * It runs the guard as a dry run before accepting, so a record that would be
 * refused at send time is refused now, while there is someone to read why.
 */
export async function approveForSending(
  organisationId: string,
  checks: Record<string, boolean>,
): Promise<ApproveResult> {
  const { supabase } = await adminSupabase();

  const ticked = Object.values(checks).filter(Boolean).length;
  if (ticked < 9) {
    return {
      ok: false,
      message: `All nine pre-send checks have to be ticked. ${ticked} of 9 are.`,
    };
  }

  const { data: row } = await supabase
    .from("crm_organisations")
    .select("email_subject, email_body, scheduled_send_at, stage, crm_contacts(id)")
    .eq("id", organisationId)
    .maybeSingle();
  const org = row as {
    email_subject: string | null;
    email_body: string | null;
    scheduled_send_at: string | null;
    stage: string;
    crm_contacts: { id: string }[] | null;
  } | null;
  if (!org) return { ok: false, message: "That record no longer exists." };
  if (!org.email_subject || !org.email_body) {
    return { ok: false, message: "Write the subject and the email first." };
  }
  if (!org.scheduled_send_at) {
    return { ok: false, message: "Give it a send time first." };
  }
  const contactId = org.crm_contacts?.[0]?.id;
  if (!contactId) return { ok: false, message: "No contact on this record." };

  // Ask the guard now, while there is somebody here to read the answer.
  // The same step the sender will use, so approval cannot pass a test the
  // send then fails. A contacted company is being followed up, not opened.
  const { error: dryErr } = await supabase.rpc("crm_dry_run_touch", {
    p_contact_id: contactId,
    p_checks: checks,
    p_step: org.stage === "queued" ? "email_1" : "email_2",
  });
  if (dryErr) return { ok: false, message: dryErr.message };

  const { error } = await supabase
    .from("crm_organisations")
    .update({
      send_approved_at: new Date().toISOString(),
      send_approved_checks: checks,
      send_error: null,
    })
    .eq("id", organisationId);
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/admin/crm/${organisationId}`);
  revalidatePath("/admin/crm/plan");
  return { ok: true, scheduledFor: org.scheduled_send_at };
}

/** Take an approved email back out of the outbox. */
export async function unapproveSending(organisationId: string): Promise<void> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_organisations")
    .update({ send_approved_at: null })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/crm/${organisationId}`);
  revalidatePath("/admin/crm/plan");
}

/**
 * Move a send to a different time.
 *
 * Approval is deliberately NOT cleared. The nine checks are about the content
 * of the email, whether the name is real and the address is published and the
 * fault is current; none of them becomes untrue because it goes at three
 * instead of nine. Making a reschedule cost nine re-ticks would train the habit
 * of ticking them without reading, which is the one thing they cannot survive.
 * Editing the BODY still clears approval, because that is a different question.
 */
export async function setScheduledSendAt(
  organisationId: string,
  iso: string | null,
): Promise<void> {
  const { supabase } = await adminSupabase();
  const { error } = await supabase
    .from("crm_organisations")
    .update({ scheduled_send_at: iso })
    .eq("id", organisationId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/crm/plan");
}

/** Put the draft in Outlook now, rather than waiting for its slot. */
export async function draftNow(
  organisationId: string,
): Promise<{ ok: true; webLink: string } | { ok: false; message: string }> {
  const { supabase } = await adminSupabase();
  const { data } = await supabase
    .from("crm_organisations")
    .select(
      "id, legal_name, trading_name, email_subject, email_body, stage, hard_warning, send_approved_checks, crm_contacts(id, first_name, surname, email_as_published, opt_out_token, opt_out_at)",
    )
    .eq("id", organisationId)
    .maybeSingle();
  const org = data as
    | (Parameters<typeof draftOutreach>[1] & {
        send_approved_checks: Record<string, boolean>;
        crm_contacts: Parameters<typeof draftOutreach>[2][] | null;
      })
    | null;
  if (!org) return { ok: false, message: "That record no longer exists." };
  const contact = org.crm_contacts?.[0];
  if (!contact) return { ok: false, message: "No contact on this record." };

  const res = await draftOutreach(
    supabase,
    org,
    contact,
    org.send_approved_checks ?? {},
    org.stage === "queued" ? "email_1" : "email_2",
  );
  if (!res.ok) return res;

  await supabase
    .from("crm_organisations")
    .update({
      draft_created_at: new Date().toISOString(),
      graph_message_id: res.id,
      graph_web_link: res.webLink,
      send_error: null,
      next_action: "Draft is in Outlook. Send it, then mark it sent here.",
    })
    .eq("id", organisationId);

  revalidatePath("/admin/crm/plan");
  revalidatePath(`/admin/crm/${organisationId}`);
  return { ok: true, webLink: res.webLink };
}

/**
 * Kyle pressed send in Outlook. Write the touch and move the pipeline on.
 *
 * This is the only place an outbound email touch is created now. The gap
 * between pressing send in Outlook and pressing this is the price of using a
 * delivery path that works, and it is a better price than a log full of
 * messages that never arrived.
 */
export async function markSent(
  organisationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { supabase } = await adminSupabase();
  const { data } = await supabase
    .from("crm_organisations")
    .select(
      "id, legal_name, trading_name, email_subject, email_body, stage, hard_warning, send_approved_checks, crm_contacts(id, first_name, surname, email_as_published, opt_out_token, opt_out_at)",
    )
    .eq("id", organisationId)
    .maybeSingle();
  const org = data as
    | (Parameters<typeof confirmSent>[1] & {
        send_approved_checks: Record<string, boolean>;
        crm_contacts: Parameters<typeof confirmSent>[2][] | null;
      })
    | null;
  if (!org) return { ok: false, message: "That record no longer exists." };
  const contact = org.crm_contacts?.[0];
  if (!contact) return { ok: false, message: "No contact on this record." };

  const wasFirst = org.stage === "queued";
  const res = await confirmSent(
    supabase,
    org,
    contact,
    org.send_approved_checks ?? {},
    wasFirst ? "email_1" : "email_2",
  );
  if (!res.ok) return { ok: false, message: res.message };

  const followup = new Date();
  followup.setDate(followup.getDate() + 8);
  await supabase
    .from("crm_organisations")
    .update({
      stage: wasFirst ? "contacted" : "followed_up",
      send_attempted_at: new Date().toISOString(),
      send_approved_at: null,
      send_error: null,
      followup_due: wasFirst ? followup.toISOString().slice(0, 10) : null,
      next_action: wasFirst
        ? "LinkedIn connect in about two hours, then follow up day 8 to 10"
        : "Sequence complete. Nothing further unless they reply.",
    })
    .eq("id", organisationId);

  revalidatePath("/admin/crm/plan");
  revalidatePath(`/admin/crm/${organisationId}`);
  return { ok: true };
}

/**
 * Lay the whole queue out across the coming weekdays, so the schedule stops
 * being something written by hand in a document and re-typed here.
 *
 * The rules it keeps, all of them Kyle's:
 *
 *  - Four a day, weekdays only.
 *  - Never on the hour or the half hour. Mail that lands at 9:00 reads as
 *    machinery; 8:47 reads as a person who happened to be at their desk. The
 *    slot times are the ones already proven in the handoff rather than random
 *    numbers, so the pattern stays plausible across a week.
 *  - WA companies go at 11:00 AEST or later, so they land mid-morning Perth
 *    rather than before anyone has sat down.
 *  - A follow-up lands inside its day 8 to 10 window, never before it opens.
 *    That constraint wins over the four-a-day shape: a follow-up sent early is
 *    worse than a day with five on it.
 *  - blocked, linkedin_only and email_closed get no slot at all.
 *
 * It only ever moves records that have not been drafted, so anything already
 * in the Outlook folder keeps the time it went out on.
 */
const DAY_SLOTS: readonly (readonly [number, number])[][] = [
  [[8, 47], [10, 26], [11, 24], [14, 23]],
  [[8, 52], [10, 34], [11, 47], [15, 7]],
  [[8, 39], [9, 26], [11, 38], [15, 22]],
  [[9, 18], [11, 41], [13, 16], [15, 41]],
];

export async function autoSchedule(
  fromISODate?: string,
): Promise<{ scheduled: number; firstDay: string | null }> {
  const { supabase } = await adminSupabase();

  const { data } = await supabase
    .from("crm_organisations")
    .select("id, legal_name, state, rank, stage, followup_due")
    .eq("brand", "ironpeak")
    .in("stage", ["queued", "contacted", "bounced"])
    .is("draft_created_at", null)
    .not("email_body", "is", null)
    .order("rank");
  const rows =
    (data as {
      id: string;
      legal_name: string;
      state: string | null;
      rank: number | null;
      stage: string;
      followup_due: string | null;
    }[] | null) ?? [];
  if (rows.length === 0) return { scheduled: 0, firstDay: null };

  // Start tomorrow unless told otherwise, so today's part-finished day is not
  // reshuffled underneath whatever is already in progress.
  const start = fromISODate ? new Date(`${fromISODate}T00:00:00+10:00`) : new Date();
  if (!fromISODate) start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);

  const followUps = rows.filter((r) => r.stage === "contacted" && r.followup_due);
  const firstContacts = rows.filter((r) => !followUps.includes(r));
  const waFirst = firstContacts.filter((r) => r.state === "WA");
  const other = firstContacts.filter((r) => r.state !== "WA");

  const updates: { id: string; at: Date }[] = [];
  const used = new Map<string, number>(); // day key -> slots taken

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

  // Follow-ups first, pinned to the day their window opens.
  for (const f of followUps) {
    const d = new Date(`${f.followup_due}T00:00:00+10:00`);
    while (isWeekend(d)) d.setDate(d.getDate() + 1);
    const k = dayKey(d);
    const i = used.get(k) ?? 0;
    const [h, m] = DAY_SLOTS[d.getDate() % DAY_SLOTS.length][Math.min(i, 3)];
    const at = new Date(d);
    at.setHours(h, m, 0, 0);
    updates.push({ id: f.id, at });
    used.set(k, i + 1);
  }

  // Then everything else, four a day, WA only into slots at 11:00 or later.
  const day = new Date(start);
  while (waFirst.length + other.length > 0) {
    if (isWeekend(day)) {
      day.setDate(day.getDate() + 1);
      continue;
    }
    const k = dayKey(day);
    const slots = DAY_SLOTS[day.getDate() % DAY_SLOTS.length];
    for (let i = used.get(k) ?? 0; i < 4; i++) {
      const [h, m] = slots[i];
      const lateEnough = h >= 11;
      const pick =
        lateEnough && waFirst.length > 0 ? waFirst.shift() : other.shift();
      // Only a late slot can take a WA company, so if the general queue is
      // empty and this slot is early, leave it empty rather than land at 6am
      // Perth.
      if (!pick) {
        if (!lateEnough || waFirst.length === 0) break;
        const wa = waFirst.shift();
        if (!wa) break;
        const at = new Date(day);
        at.setHours(h, m, 0, 0);
        updates.push({ id: wa.id, at });
        used.set(k, i + 1);
        continue;
      }
      const at = new Date(day);
      at.setHours(h, m, 0, 0);
      updates.push({ id: pick.id, at });
      used.set(k, i + 1);
    }
    day.setDate(day.getDate() + 1);
  }

  for (const u of updates) {
    const { error } = await supabase
      .from("crm_organisations")
      .update({ scheduled_send_at: u.at.toISOString() })
      .eq("id", u.id);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/admin/crm/plan");
  return {
    scheduled: updates.length,
    firstDay: updates.length
      ? updates.map((u) => u.at).sort((a, b) => a.getTime() - b.getTime())[0]
          .toISOString()
      : null,
  };
}
