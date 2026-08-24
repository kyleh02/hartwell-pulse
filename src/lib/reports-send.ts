import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, emailLayout, renderMessage, type EmailAttachment } from "@/lib/email";
import { resolveRecipients, firstName } from "@/lib/recipients";
import { monthLabel } from "@/lib/metrics";
import { DEFAULT_REPORT_EMAIL } from "@/lib/reports-shared";
import type { Report } from "@/lib/types/database";

export type SendReportResult =
  | {
      ok: true;
      sentTo: string[];
      /**
       * The PDF filename that went with it, or null if none was attached.
       *
       * Reported back rather than left implicit so a test send can say which
       * of the two emails it was. "It looked fine" is not an answer to "did
       * the attachment go", and that is the whole question a test is asked.
       */
      attached: string | null;
    }
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

  // ---- the PDF, fetched once rather than once per recipient ----
  //
  // If one is attached it MUST go. A send that quietly drops it looks
  // identical to a send that never had one, and the client is left doing the
  // exact thing the attachment exists to save her from. So a failure here
  // stops the send and says why, rather than degrading to a link-only email
  // nobody knows is degraded.
  let attachments: EmailAttachment[] | undefined;
  if (report.pdf_path) {
    const { data: file, error: dlErr } = await supabase.storage
      .from("pulse-reports")
      .download(report.pdf_path);
    if (dlErr || !file) {
      return {
        ok: false,
        message: `The attached PDF could not be read (${dlErr?.message ?? "not found"}). Upload it again, or remove it, then send.`,
      };
    }
    attachments = [
      {
        filename: report.pdf_name || "report.pdf",
        content: Buffer.from(await file.arrayBuffer()).toString("base64"),
      },
    ];
  }

  const month = monthLabel(report.period_month);
  const template = report.email_message || DEFAULT_REPORT_EMAIL;
  const subject = opts.testTo
    ? `[Test] Your ${month} report is ready`
    : `Your ${month} report is ready`;

  // Said by the sender rather than written into the template, because whether
  // there is a PDF is a fact about this send and the template is Kyle's words.
  // Without it the attachment is a paperclip the reader has to notice.
  const attachedLine = attachments
    ? `<p style="margin:0 0 16px">The PDF is attached to this email, so you can read it without signing in.</p>`
    : "";

  const build = (greeting: string) =>
    emailLayout(
      `Your ${month} report`,
      renderMessage(template, {
        name: greeting,
        client: clientName,
        month,
        title: report.title,
      }) + attachedLine,
      "Read report",
      `/reports/${reportId}`,
    );

  if (opts.testTo) {
    // The test carries the attachment too. A proof that leaves out the one
    // thing being changed is not a proof.
    await sendEmail({
      to: opts.testTo,
      subject,
      html: build("Kyle"),
      ref: { kind: "report", id: reportId },
      attachments,
    });
    return {
      ok: true,
      sentTo: [opts.testTo],
      attached: attachments ? (report.pdf_name ?? "the PDF") : null,
    };
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
      await sendEmail({
        to: p.email,
        subject,
        html: build(firstName(p)),
        ref: { kind: "report", id: reportId },
        attachments,
      });
      sentTo.push(p.email);
    }
  }

  // Stamped last, so a failure part way through leaves it looking unsent and
  // Kyle sends again rather than believing it landed.
  await supabase.from("reports").update({ sent_at: now }).eq("id", reportId);

  return {
    ok: true,
    sentTo,
    attached: attachments ? (report.pdf_name ?? "the PDF") : null,
  };
}
