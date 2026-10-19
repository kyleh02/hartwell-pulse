import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMoney, DEFAULT_INVOICE_EMAIL } from "@/lib/invoices-shared";
import {
  sendEmail,
  emailLayout,
  renderMessage,
  escapeHtml,
  type EmailAttachment,
} from "@/lib/email";
import { collectExtraAttachments } from "@/lib/invoice-attachments-send";
import { resolveRecipients, type Recipient } from "@/lib/recipients";
import type { Invoice } from "@/lib/types/database";
import { billToFromClient, type ClientBilling } from "@/lib/billing";
import { isMissingColumn } from "@/lib/db-errors";

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
): Promise<{ attached: string[] }> {
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
  // Attach what is already there. NOTHING is rendered here, and that is a
  // correction rather than a preference.
  //
  // The first version made the PDF at this point, reasoning that an invoice
  // has no publish step to hang it on. That reasoning was about failure
  // semantics and missed where the code runs: this is reached from a server
  // action, which inherits the page's ten seconds on Hobby, and a cold
  // Chromium start does not finish in ten. Pressing Send hung and died.
  //
  // The report path never had this problem because rendering was deliberately
  // kept off the send. So is this one now. The editor makes the PDF through
  // /api/invoices/[id]/pdf, which is a route handler and may take sixty
  // seconds, and the send simply carries whatever exists.
  //
  // A missing PDF never stops the send. An invoice that does not arrive is
  // worse than one that arrives carrying a link, and the recurring cron sends
  // these with nobody watching.
  let attachments: EmailAttachment[] | undefined;
  if (invoice.pdf_path) {
    const { data: file, error: dlErr } = await supabase.storage
      .from("pulse-reports")
      .download(invoice.pdf_path);
    if (dlErr || !file) {
      console.warn(`[invoice ${invoiceId}] PDF unreadable: ${dlErr?.message}`);
    } else {
      attachments = [
        {
          filename: invoice.pdf_name || "invoice.pdf",
          content: Buffer.from(await file.arrayBuffer()).toString("base64"),
        },
      ];
    }
  }

  // Whether the invoice's OWN PDF made it, captured before anything else joins
  // the list. The email says "the invoice is attached" on the strength of this,
  // and saying so because some other document is attached would be untrue.
  const pdfFileName = attachments?.[0]?.filename ?? null;

  // ---- the documents sent alongside it ----
  //
  // Read BEFORE any email goes out, so a hand send that cannot read one stops
  // here with nothing sent, naming the file. An unattended send carries on
  // without it and says what was left off in the admin heads-up below.
  // adminNotice is set only by the scheduled jobs, which is what makes it the
  // test for whether anyone is watching.
  const extras = await collectExtraAttachments(supabase, invoiceId, {
    unattended: !!opts.adminNotice,
  });
  if (extras.files.length > 0) {
    attachments = [...(attachments ?? []), ...extras.files];
  }
  const sentFileNames = [...(pdfFileName ? [pdfFileName] : []), ...extras.names];

  const amended = (invoice.revision ?? 0) > 0;
  // An instalment announces itself as one. "New invoice" on the second half of
  // an agreed split is exactly the wrong words on exactly the wrong document.
  const noun = invoice.instalment_number
    ? `Instalment ${invoice.instalment_number} of ${invoice.instalment_count}`
    : amended
      ? "Updated invoice"
      : "New invoice";
  const subject = opts.testTo
    ? `[Test] ${noun} ${invoice.invoice_number}`
    : `${noun} ${invoice.invoice_number}`;
  // Said by the sender rather than written into the template, because whether
  // there is a PDF is a fact about this send and the template is Kyle's words.
  //
  // Names are escaped: they are typed by a person and land in HTML.
  const attachedLine =
    (pdfFileName
      ? `<p style="margin:0 0 16px">The invoice is attached to this email, so you can pay it without signing in.</p>`
      : "") +
    (extras.names.length > 0
      ? `<p style="margin:0 0 16px">${pdfFileName ? "Also attached" : "Attached"}: ${extras.names
          .map((n) => escapeHtml(n))
          .join(", ")}.</p>`
      : "");
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
    // A proof changes nothing: no notification, no status, no record. It does
    // report what it carried, because "did both documents go" is the question a
    // test exists to answer and the inbox is not the only place to answer it.
    return { attached: sentFileNames };
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
  const sendRecord = {
    invoice_id: invoiceId,
    client_id: invoice.client_id,
    revision: invoice.revision ?? 0,
    total: invoice.total,
    due_date: invoice.due_date,
    sent_to: delivered,
    kind: opts.resend ? "resend" : "send",
  };
  const { error: recordErr } = await supabase
    .from("invoice_sends")
    .insert({ ...sendRecord, attachment_names: sentFileNames });
  if (recordErr) {
    // Before migration 0051 the column does not exist and the whole insert is
    // refused, which would lose the record of this send entirely rather than
    // just the file names. The emails have already gone, so keep the record.
    const code = (recordErr as { code?: string }).code;
    if (code === "PGRST204" || code === "42703") {
      const { error: retryErr } = await supabase
        .from("invoice_sends")
        .insert(sendRecord);
      if (retryErr) {
        console.error(`[invoice ${invoiceId}] send not recorded: ${retryErr.message}`);
      }
    } else {
      console.error(`[invoice ${invoiceId}] send not recorded: ${recordErr.message}`);
    }
  }

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
        // Nobody watched this send, so anything left off has to be said here or
        // it is never found out.
        body:
          `${formatMoney(invoice.total)} · due ${prettyDate(invoice.due_date)}` +
          (extras.skipped.length > 0
            ? ` · NOT attached, could not be read: ${extras.skipped.join(", ")}`
            : ""),
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
  // Freeze the Bill to block as it was issued, so changing the client's profile
  // later cannot rewrite what this invoice says it was billed to. Read and
  // written on their own, so a missing column before 0052 costs the snapshot and
  // never the send.
  const { data: billRow, error: billReadErr } = await supabase
    .from("clients")
    .select("business_name, legal_name, abn, billing_address, billing_attention")
    .eq("id", invoice.client_id)
    .maybeSingle();
  if (!billReadErr && billRow) {
    const { error: billErr } = await supabase
      .from("invoices")
      .update({ bill_to: billToFromClient(billRow as ClientBilling) })
      .eq("id", invoiceId);
    if (billErr && !isMissingColumn(billErr)) {
      console.error(`[invoice ${invoiceId}] Bill to not frozen: ${billErr.message}`);
    }
  }

  await supabase
    .from("invoices")
    .update({
      status: "sent",
      sent_at: invoice.sent_at ?? now,
      last_sent_at: now,
    })
    .eq("id", invoiceId);

  return { attached: sentFileNames };
}
