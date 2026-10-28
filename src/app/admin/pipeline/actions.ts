"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { leadTitle, type Lead, type LeadStage } from "@/lib/pipeline-shared";
import {
  createLeadOp,
  logActivityOp,
  logActivityRow,
  moveLeadOp,
  updateLeadOp,
  type LeadInput,
  type OpResult,
} from "@/lib/pipeline-ops";
import { provisionClient, signInLink } from "@/lib/provision";
import { welcomeEmail } from "@/lib/welcome-emails";
import { sendEmail } from "@/lib/email";
import { HARTWELL } from "@/lib/brand";

// The work itself lives in src/lib/pipeline-ops.ts, shared with Claude's
// connector. These are the portal's doors to it: an admin check, then a
// refresh of the pages that show the result.

type Result<T = object> = OpResult<T>;

async function admin() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return { session, supabase: await createServerSupabase() };
}

function refresh(id?: string) {
  revalidatePath("/admin/pipeline");
  if (id) revalidatePath(`/admin/pipeline/${id}`);
  revalidatePath("/admin");
}

/** A new lead, followed up tomorrow unless a date is given. */
export async function createLead(input: LeadInput): Promise<Result<{ id: string; warning: string | null }>> {
  const { session, supabase } = await admin();
  const res = await createLeadOp(supabase, session.clerkUserId, input);
  if (res.ok) refresh(res.id);
  return res;
}

export async function updateLead(id: string, input: LeadInput): Promise<Result> {
  const { supabase } = await admin();
  const res = await updateLeadOp(supabase, id, input);
  if (res.ok) refresh(id);
  return res;
}

/** Move along the board. Won goes through `onboardLead` instead. */
export async function moveLead(id: string, stage: LeadStage, reason?: string): Promise<Result> {
  const { session, supabase } = await admin();
  const res = await moveLeadOp(supabase, session.clerkUserId, id, stage, reason);
  if (res.ok) refresh(id);
  return res;
}

export async function logLeadActivity(id: string, kind: "note" | "call" | "email" | "meeting", body: string): Promise<Result> {
  const { session, supabase } = await admin();
  const res = await logActivityOp(supabase, session.clerkUserId, id, kind, body);
  if (res.ok) refresh(id);
  return res;
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
  await logActivityRow(supabase, leadId, "won", `Onboarded as ${input.businessName.trim()}`, session.clerkUserId);

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
