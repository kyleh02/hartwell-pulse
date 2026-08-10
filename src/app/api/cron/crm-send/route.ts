import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { graphConfigured } from "@/lib/graph";
import { sendOutreach } from "@/lib/crm-send";

/**
 * Fires approved outreach at its scheduled minute.
 *
 * Runs every few minutes from cron-job.org, the same way the other sub-daily
 * jobs do, because Vercel Hobby caps its own crons at once a day and these
 * sends are scheduled to the minute.
 *
 * Three conditions, all required: the record is approved by a human, its
 * scheduled time has arrived, and it has not already been sent. Approval is
 * the one that matters. A machine is sending cold email on Kyle's behalf while
 * he is asleep, and nothing goes that he has not read.
 */
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }
  if (!graphConfigured()) {
    return new Response("Outlook sending is not configured", { status: 503 });
  }

  const supabase = createAdminSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("crm_organisations")
    .select(
      "id, legal_name, trading_name, email_subject, email_body, stage, hard_warning, send_approved_checks, crm_contacts(id, first_name, surname, email_as_published, opt_out_token, opt_out_at)",
    )
    .eq("brand", "ironpeak")
    // BOTH stages. Three of the eighteen scheduled sends are follow-ups to
    // companies already contacted, and filtering to "queued" left them
    // approved and silently unsendable. blocked, linkedin_only and the
    // terminal stages are excluded by not being in this list; the guard
    // refuses them again anyway.
    .in("stage", ["queued", "contacted"])
    .not("send_approved_at", "is", null)
    .not("scheduled_send_at", "is", null)
    .lte("scheduled_send_at", now)
    .order("scheduled_send_at");
  if (error) return new Response(error.message, { status: 500 });

  type Row = Parameters<typeof sendOutreach>[1] & {
    send_approved_checks: Record<string, unknown>;
    crm_contacts: Parameters<typeof sendOutreach>[2][] | null;
  };
  const due = (data as Row[] | null) ?? [];

  const results: { company: string; status: string }[] = [];

  for (const org of due) {
    const contact = org.crm_contacts?.[0];
    if (!contact) {
      results.push({ company: org.legal_name, status: "skipped-no-contact" });
      continue;
    }

    const outcome = await sendOutreach(
      supabase,
      org,
      contact,
      org.send_approved_checks ?? {},
      // A follow-up is the second email, not the first. email_1 carries the
      // extra gate about technical and positive findings, which is a rule
      // about opening a conversation, not continuing one.
      org.stage === "queued" ? "email_1" : "email_2",
    );

    if (outcome.ok) {
      const wasFirst = org.stage === "queued";
      const followup = new Date();
      followup.setDate(followup.getDate() + 8);
      // Stage advances here rather than in sendOutreach, so the send stays one
      // thing and the pipeline's opinion about it stays another.
      await supabase
        .from("crm_organisations")
        .update({
          stage: wasFirst ? "contacted" : "followed_up",
          send_attempted_at: new Date().toISOString(),
          send_error: null,
          // CLEARING THIS IS WHAT STOPS A SECOND SEND. The query now includes
          // "contacted", so without it a first contact would be picked up
          // again five minutes later and emailed the same thing forever.
          send_approved_at: null,
          // Two emails per company, ever. After the follow-up there is no
          // third, so nothing further is booked.
          followup_due: wasFirst ? followup.toISOString().slice(0, 10) : null,
          next_action: wasFirst
            ? "LinkedIn connect in about two hours, then follow up day 8 to 10"
            : "Sequence complete. Nothing further unless they reply.",
        })
        .eq("id", org.id);
      results.push({
        company: org.legal_name,
        status: wasFirst ? "sent" : "followed-up",
      });
      continue;
    }

    // A permanent failure clears the approval so it stops being retried every
    // few minutes forever and starts being a thing Kyle has to look at.
    await supabase
      .from("crm_organisations")
      .update({
        send_attempted_at: new Date().toISOString(),
        send_error: outcome.message,
        ...(outcome.permanent ? { send_approved_at: null } : {}),
      })
      .eq("id", org.id);
    results.push({
      company: org.legal_name,
      status: `${outcome.permanent ? "failed" : "retrying"}:${outcome.message}`,
    });
  }

  return Response.json({ checked: due.length, results });
}
