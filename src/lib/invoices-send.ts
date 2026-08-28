import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMoney, DEFAULT_INVOICE_EMAIL } from "@/lib/invoices-shared";
import { sendEmail, emailLayout, renderMessage, type EmailAttachment } from "@/lib/email";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { resolveRecipients, type Recipient } from "@/lib/recipients";
import type { Invoice } from "@/lib/types/database";

function prettyDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export type InvoiceRecipient = Recipient;

/**
 * Who hears about this invoice: the send, the heads-up before it is due, and
 * the overdue reminder. All three call this, so they can never drift apart.
 * The rule itself lives in resolveRecipients — see the note there on why an
 * empty list means everyone and an empty result means stop.
 */
export async function invoiceRecipients(
  supabase: SupabaseClient,
  invoice: Pick<Invoice, "client_id" | "recipient_user_ids">,
): Promise<InvoiceRecipient[]> {
  return resolveRecipients(
    supabase,
    invoice.client_id,
    invoice.recipient_user_ids,
  );
}

/**
 * Mark an invoice as sent, email it to the client, and create the in-portal
 * notification. Works with either the RLS server client (manual "Send" button)
 * or the service-role client (the recurring cron) — it only takes a client + id.
 *
 * opts.adminNotice=true also drops an in-portal heads-up to the admin(s), used by
 * the recurring auto-send so a machine never bills a client silently.
 *
 * opts.testTo sends the identical email to one address and does nothing else:
 * no client notification, no status change, nothing recorded. It exists so a
 * proof can be read in a real inbox before a client ever sees it.
 */
export async function sendInvoiceWith(
  supabase: SupabaseClient,
  invoiceId: string,
  opts: { adminNotice?: boolean; testTo?: string; resend?: boolean } = {},
): Promise<void> {
  const { data: inv } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) throw new Error("Invoice not found");
  const invoice = inv as Invoice;

  const [{ data: clientRow }, { data: settings }, users] = await Promise.all([
    supabase
      .from("clients")
      .select("business_name")
      .eq("id", invoice.client_id)
      .maybeSingle(),
    supabase
      .from("business_settings")
      .select("invoice_email_message")
      .eq("id", 1)
      .maybeSingle(),
    invoiceRecipients(supabase, invoice),
  ]);

  const clientName =
    (clientRow as { business_name?: string } | null)?.business_name ?? "there";
  const template =
    invoice.email_message ||
    (settings as { invoice_email_message?: string | null } | null)
      ?.invoice_email_message ||
    DEFAULT_INVOICE_EMAIL;
  const messageHtml = renderMessage(template, {
    client: clientName,
    invoice: invoice.invoice_number,
    amount: formatMoney(invoice.total),
    "due date": prettyDate(invoice.due_date),
  });

  // An invoice that has been corrected and reissued is not a new invoice, and
  // calling it one leaves the client wondering whether they now owe twice.
  // Revision is the honest test: it only moves when the invoice was actually
  // changed after it went out. A plain resend of an unchanged invoice still
  // reads as the original, which is what it is.
  // ---- the PDF, made if missing, fetched once ----
  //
  // An invoice has no publish step to hang the render on, so this is where it
  // happens. And unlike a report, a failure here NEVER stops the send: the
  // recurring cron sends invoices with nobody watching, and an invoice that
  // does not arrive is worse than one that arrives with a link instead of an
  // attachment. So every branch below falls through to sending.
  let attachments: EmailAttachment[] | undefined;
  let pdfPath = invoice.pdf_path;
  let pdfName = invoice.pdf_name;
  if (!pdfPath) {
    const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    if (origin) {
      const made = await renderInvoicePdf(supabase, invoiceId, origin);
      if (made.ok) {
        const { data: fresh } = await supabase
          .from("invoices")
          .select("pdf_path, pdf_name")
          .eq("id", invoiceId)
          .maybeSingle();
        pdfPath = (fresh as { pdf_path: string | null } | null)?.pdf_path ?? null;
        pdfName = (fresh as { pdf_name: string | null } | null)?.pdf_name ?? null;
      } else {
        console.warn(`[invoice ${invoiceId}] PDF render failed: ${made.message}`);
      }
    }
  }
  if (pdfPath) {
    const { data: file, error: dlErr } = await supabase.storage
      .from("pulse-reports")
      .download(pdfPath);
    if (dlErr || !file) {
      console.warn(`[invoice ${invoiceId}] PDF unreadable: ${dlErr?.message}`);
    } else {
      attachments = [
        {
          filename: pdfName || "invoice.pdf",
          content: Buffer.from(await file.arrayBuffer()).toString("base64"),
        },
      ];
    }
  }

  const amended = (invoice.revision ?? 0) > 0;
  const noun = amended ? "Updated invoice" : "New invoice";
  const subject = opts.testTo
    ? `[Test] ${noun} ${invoice.invoice_number}`
    : `${noun} ${invoice.invoice_number}`;
  // Said by the sender rather than written into the template, because whether
  // there is a PDF is a fact about this send and the template is Kyle's words.
  const attachedLine = attachments
    ? `<p style="margin:0 0 16px">The invoice is attached to this email, so you can pay it without signing in.</p>`
    : "";
  const notifTitle = `${noun} ${invoice.invoice_number} for ${formatMoney(invoice.total)}`;
  const notifBody = `Due ${prettyDate(invoice.due_date)}.`;
  const now = new Date().toISOString();

  if (opts.testTo) {
    const html = emailLayout(
      `${noun}: ${invoice.invoice_number}`,
      messageHtml + attachedLine,
      "View invoice",
      `/invoices/${invoiceId}`,
    );
    // The test carries the attachment too. A proof that leaves out the thing
    // being changed is not a proof.
    await sendEmail({
      to: opts.testTo,
      subject,
      html,
      ref: { kind: "invoice", id: invoiceId },
      attachments,
    });
    return; // A proof changes nothing: no notification, no status, no record.
  }

  // Stop rather than report a send that reached nobody. This only happens when
  // every chosen recipient has left the account, and the fix is to pick
  // someone who is still on it. The invoice stays a draft.
  if (users.length === 0) {
    throw new Error(
      "No one on this account is set to receive this invoice. Choose a recipient under Send to, then try again.",
    );
  }

  const delivered: string[] = [];

  for (const u of users) {
    await supabase.from("notifications").insert({
      recipient_user_id: u.clerk_user_id,
      client_id: invoice.client_id,
      type: "invoice",
      title: notifTitle,
      body: notifBody,
      link: `/invoices/${invoiceId}`,
      channel: "instant",
      emailed_at: now,
    });
    if (u.email) {
      const html = emailLayout(
        `${noun}: ${invoice.invoice_number}`,
        messageHtml + attachedLine,
        "View invoice",
        `/invoices/${invoiceId}`,
      );
      await sendEmail({
        to: u.email,
        subject,
        html,
        ref: { kind: "invoice", id: invoiceId },
        attachments,
      });
      delivered.push(u.email);
    }
  }

  // What went out, as it stood, to whom. Written before the status flip so a
  // send that half-succeeds still leaves evidence of what reached an inbox.
  // Snapshotted rather than joined: a later correction is exactly the thing
  // that would otherwise rewrite this history.
  await supabase.from("invoice_sends").insert({
    invoice_id: invoiceId,
    client_id: invoice.client_id,
    revision: invoice.revision ?? 0,
    total: invoice.total,
    due_date: invoice.due_date,
    sent_to: delivered,
    kind: opts.resend ? "resend" : "send",
  });

  if (opts.adminNotice) {
    const { data: admins } = await supabase
      .from("client_users")
      .select("clerk_user_id")
      .eq("role", "admin");
    for (const a of (admins as { clerk_user_id: string }[] | null) ?? []) {
      await supabase.from("notifications").insert({
        recipient_user_id: a.clerk_user_id,
        client_id: invoice.client_id,
        type: "invoice",
        title: `Auto-sent ${invoice.invoice_number} to ${clientName}`,
        body: `${formatMoney(invoice.total)} · due ${prettyDate(invoice.due_date)}`,
        link: `/admin/invoices/${invoiceId}`,
        channel: "in_portal",
      });
    }
  }

  // Flip to "sent" only after the email + notifications have been dispatched, so
  // a hard failure mid-send leaves the invoice as a draft. The recurring cron
  // re-attempts the send for an existing un-sent invoice rather than skipping it.
  //
  // sent_at is set once and never moved. It is when the invoice was issued, and
  // a correction reissued three days later does not change that. last_sent_at
  // carries the resends.
  await supabase
    .from("invoices")
    .update({
      status: "sent",
      sent_at: invoice.sent_at ?? now,
      last_sent_at: now,
    })
    .eq("id", invoiceId);
}
