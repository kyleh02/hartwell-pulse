import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, emailLayout, renderMessage } from "@/lib/email";
import { resolveRecipients, firstName } from "@/lib/recipients";
import { monthLabel } from "@/lib/metrics";
import { DEFAULT_REPORT_EMAIL } from "@/lib/reports-shared";
import type { Report } from "@/lib/types/database";

export type SendReportResult =
  | { ok: true; sentTo: string[] }
  | { ok: false; message: string };

/**
 * Email a published report to the people chosen on it, and notify them in the
 * portal.
 *
 * This replaced a database trigger that dropped a line into everyone's WEEKLY
 * digest on publish. A finished report could sit unmentioned for six days, it
 * went to every person on the account whether or not it was meant for them,
 * and nothing recorded that it had gone.
 *
 * opts.testTo sends the identical email to one address and does nothing else:
 * no notification, no sent_at, nothing recorded. It exists so the thing can be
 * read in a real inbox before a client ever sees it. The same proof-before-send
 * habit that invoices have.
 */
export async function sendReportWith(
  supabase: SupabaseClient,
  reportId: string,
  opts: { testTo?: string } = {},
): Promise<SendReportResult> {
  const { data: row } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  const report = row as Report | null;
  if (!report) return { ok: false, message: "That report no longer exists." };

  if (report.status !== "published" && !opts.testTo) {
    return {
      ok: false,
      message:
        "Publish the report first. A client cannot open a draft, so the email would arrive with a link to nothing.",
    };
  }

  const { data: clientRow } = await supabase
    .from("clients")
    .select("business_name")
    .eq("id", report.client_id)
    .maybeSingle();
  const clientName =
    (clientRow as { business_name?: string } | null)?.business_name ?? "there";

  const month = monthLabel(report.period_month);
  const template = report.email_message || DEFAULT_REPORT_EMAIL;
  const subject = opts.testTo
    ? `[Test] Your ${month} report is ready`
    : `Your ${month} report is ready`;

  const build = (greeting: string) =>
    emailLayout(
      `Your ${month} report`,
      renderMessage(template, {
        name: greeting,
        client: clientName,
        month,
        title: report.title,
      }),
      "Read report",
      `/reports/${reportId}`,
    );

  if (opts.testTo) {
    await sendEmail({ to: opts.testTo, subject, html: build("Kyle"), ref: { kind: "report", id: reportId } });
    return { ok: true, sentTo: [opts.testTo] };
  }

  const people = await resolveRecipients(
    supabase,
    report.client_id,
    report.recipient_user_ids,
  );
  if (people.length === 0) {
    return {
      ok: false,
      message:
        "No one on this account is set to receive this report. Choose someone under Send to, then try again.",
    };
  }

  const now = new Date().toISOString();
  const sentTo: string[] = [];

  for (const p of people) {
    await supabase.from("notifications").insert({
      recipient_user_id: p.clerk_user_id,
      client_id: report.client_id,
      type: "report_ready",
      title: `Your ${month} report is ready to view`,
      body: report.title,
      link: `/reports/${reportId}`,
      // Instant, and already emailed here, so the weekly digest does not
      // repeat it. A report is the month's work; it should not wait for a
      // Friday summary.
      channel: "instant",
      emailed_at: now,
    });
    if (p.email) {
      await sendEmail({ to: p.email, subject, html: build(firstName(p)), ref: { kind: "report", id: reportId } });
      sentTo.push(p.email);
    }
  }

  // Stamped last, so a failure part way through leaves it looking unsent and
  // Kyle sends again rather than believing it landed.
  await supabase.from("reports").update({ sent_at: now }).eq("id", reportId);

  return { ok: true, sentTo };
}
