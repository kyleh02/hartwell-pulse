import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { graphCreateDraft } from "@/lib/graph";

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
 * THE OPT-OUT IS A REPLY, NOT A LINK, and that was a correction rather than a
 * preference. The link pointed at portal.hartwelldigital.com and was wrong on
 * three counts, each sufficient on its own: the domain did not match the
 * sending domain, which is a strong spam signal on cold mail; the token made
 * it per-recipient tracking, which the settled rules forbid on first contact;
 * and it published the tie between Ironpeak and Hartwell Digital to every
 * prospect, breaching the standing brand constraint. Careful work went into
 * keeping the Hartwell wordmark off the opt-out PAGE while the Hartwell domain
 * sat in the link above it.
 *
 * A reply satisfies the Spam Act. What the Act requires is a functional,
 * low-cost way to opt out that is honoured; on genuine person-to-person mail a
 * reply is exactly that, and it is what a real person would write. Honouring
 * it is the operator's job, and the guard blocks every channel the moment
 * opt_out_at is set.
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

/**
 * Plain, human, and no link. Kyle has explicitly rejected formal unsubscribe
 * blocks that read as automated, and on an email meant to pass as 1:1 one of
 * those is also a tell that it is not.
 */
export const OPT_OUT =
  "If you would rather not hear from me again, just reply and say so. I will not write again.";

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

export function buildOutreachText(body: string): string {
  return [body.trim(), "", SIGNATURE, "", OPT_OUT].join("\n");
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
/**
 * Put one approved email into the Outlook drafts folder.
 *
 * Deliberately does NOT log a touch. A draft is not a send, and the touch log
 * is the Spam Act record; writing one here would record messages that never
 * left, which is precisely the failure that caused this rewrite. The touch is
 * written by confirmSent, after the email has actually gone.
 *
 * The guard is still asked first, and asked in full. A record that could not
 * lawfully be emailed must not get a ready-to-send draft sitting in a folder
 * waiting for a tired thumb.
 */
export async function draftOutreach(
  supabase: SupabaseClient,
  org: OutreachTarget,
  contact: OutreachContact,
  checks: Record<string, unknown>,
  step: "email_1" | "email_2" = "email_1",
): Promise<
  { ok: true; id: string; webLink: string } | { ok: false; message: string }
> {
  if (!org.email_body || !org.email_subject) {
    return { ok: false, message: "No email written for this record." };
  }
  if (!contact.email_as_published) {
    return { ok: false, message: "No published address on the contact." };
  }
  if (contact.opt_out_at) {
    return { ok: false, message: "This contact has opted out." };
  }
  if (["blocked", "linkedin_only", "email_closed"].includes(org.stage)) {
    return {
      ok: false,
      message:
        org.stage === "email_closed"
          ? "Email to this company is closed: their server refuses it. Use LinkedIn or the phone."
          : `Stage is ${org.stage}, which cannot send.`,
    };
  }

  const { error: dryErr } = await supabase.rpc("crm_dry_run_touch", {
    p_contact_id: contact.id,
    p_checks: checks,
    p_step: step,
  });
  if (dryErr) return { ok: false, message: dryErr.message };

  try {
    const draft = await graphCreateDraft({
      to: contact.email_as_published,
      subject: org.email_subject,
      text: buildOutreachText(org.email_body),
    });
    return { ok: true, ...draft };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not create the draft.",
    };
  }
}

/**
 * Record that a drafted email was actually sent.
 *
 * This is where the touch is written, and it is written with the exact text
 * that was drafted. Kyle presses send in Outlook, then confirms here; the gap
 * between those two is the price of using a delivery path that works.
 */
export async function confirmSent(
  supabase: SupabaseClient,
  org: OutreachTarget,
  contact: OutreachContact,
  checks: Record<string, unknown>,
  step: "email_1" | "email_2" = "email_1",
): Promise<SendOutcome> {
  if (!org.email_body || !org.email_subject) {
    return { ok: false, message: "No email on this record.", permanent: true };
  }

  const { error } = await supabase.from("crm_touches").insert({
    contact_id: contact.id,
    organisation_id: org.id,
    channel: "email",
    sequence_step: step,
    direction: "out",
    subject: org.email_subject,
    body_snapshot: buildOutreachText(org.email_body),
    presend_checks: checks,
  });
  if (error) return { ok: false, message: error.message, permanent: true };
  return { ok: true };
}
