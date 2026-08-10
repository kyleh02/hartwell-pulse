import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { graphSendMail } from "@/lib/graph";

/**
 * Composing and sending one outreach email.
 *
 * Everything that must appear on a commercial electronic message is appended
 * here rather than typed into each body, because a footer retyped 30 times is
 * a footer that is wrong on at least one of them. The Spam Act needs accurate
 * sender identification and a functional opt-out; both are below and neither
 * can be edited away in the composer.
 *
 * No phone number, on the brief's own rule. No mention of Hartwell Digital
 * either: a prospect must never see the parent brand.
 *
 * The opt-out line is written like a person wrote it. Kyle has explicitly
 * rejected formal unsubscribe blocks that read as automated, and on a genuine
 * 1:1 email one is also a tell that it is not one.
 */

/** Verbatim from the handoff. Text only, no images, no phone number, ever. */
export const SIGNATURE = [
  "Kind regards,",
  "",
  "Kyle Hartwell",
  "Ironpeak Consulting",
  "kyle@ironpeakconsulting.com.au",
  "ironpeakconsulting.com.au",
  "linkedin.com/company/ironpeak-consulting",
].join("\n");

export interface OutreachTarget {
  id: string;
  legal_name: string;
  trading_name: string | null;
  email_subject: string | null;
  email_body: string | null;
  stage: string;
  hard_warning: string | null;
}

export interface OutreachContact {
  id: string;
  first_name: string | null;
  surname: string | null;
  email_as_published: string | null;
  opt_out_token: string;
  opt_out_at: string | null;
}

export function buildOutreachText(body: string, optOutToken: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return [
    body.trim(),
    "",
    SIGNATURE,
    "",
    `Not interested in hearing from me? ${appUrl}/unsubscribe/${optOutToken} and I will not write again.`,
  ].join("\n");
}

export type SendOutcome =
  | { ok: true }
  | { ok: false; message: string; permanent: boolean };

/**
 * Send one approved outreach email and record it.
 *
 * Order matters. The email goes first, then the touch is logged. Logging first
 * would mean a failed send leaves a record saying an email was sent that never
 * was, which is worse than a send with no record: the touch log is the Spam Act
 * evidence, and evidence of something that did not happen is not evidence.
 *
 * The insert into crm_touches runs through crm_touch_guard, which is the real
 * gate. If the contact opted out between approval and send, if the company was
 * moved to blocked, if the checks are incomplete, the trigger refuses. That is
 * deliberate: the guard is the last word, not this function.
 */
export async function sendOutreach(
  supabase: SupabaseClient,
  org: OutreachTarget,
  contact: OutreachContact,
  checks: Record<string, unknown>,
  step: "email_1" | "email_2" = "email_1",
): Promise<SendOutcome> {
  if (!org.email_body || !org.email_subject) {
    return { ok: false, message: "No email written for this record.", permanent: true };
  }
  if (!contact.email_as_published) {
    return { ok: false, message: "No published address on the contact.", permanent: true };
  }
  if (contact.opt_out_at) {
    return { ok: false, message: "This contact has opted out.", permanent: true };
  }
  if (org.stage === "blocked" || org.stage === "linkedin_only") {
    return {
      ok: false,
      message: `Stage is ${org.stage}, which cannot send.`,
      permanent: true,
    };
  }

  const text = buildOutreachText(org.email_body, contact.opt_out_token);

  // Dry run through the guard BEFORE anything leaves. The trigger is what
  // enforces the two-email cap, the opt-out block and the nine checks, and
  // finding out it refuses after the email has gone is finding out too late.
  const { error: dryErr } = await supabase.rpc("crm_dry_run_touch", {
    p_contact_id: contact.id,
    p_checks: checks,
    p_step: step,
  });
  if (dryErr) {
    return { ok: false, message: dryErr.message, permanent: true };
  }

  try {
    await graphSendMail({
      to: contact.email_as_published,
      subject: org.email_subject,
      text,
    });
  } catch (e) {
    // A transport failure is worth retrying on the next pass; a refusal from
    // Graph about permissions or a bad address is not.
    const message = e instanceof Error ? e.message : "Send failed";
    const permanent = /40[0-4]|InvalidRecipients|ErrorInvalidUser/i.test(message);
    return { ok: false, message, permanent };
  }

  const { error } = await supabase.from("crm_touches").insert({
    contact_id: contact.id,
    organisation_id: org.id,
    channel: "email",
    sequence_step: step,
    direction: "out",
    subject: org.email_subject,
    // What was ACTUALLY sent, footer and all. If a complaint arrives, this is
    // the defence, and it has to be the real thing rather than the template.
    body_snapshot: text,
    presend_checks: checks,
  });
  if (error) {
    // The email is already gone. Say so loudly rather than pretending it did
    // not happen: an unlogged send is a compliance gap, not a retry.
    return {
      ok: false,
      message: `SENT but not logged, fix by hand: ${error.message}`,
      permanent: true,
    };
  }

  return { ok: true };
}
