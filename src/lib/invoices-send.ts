import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMoney, DEFAULT_INVOICE_EMAIL } from "@/lib/invoices-shared";
import { sendEmail, emailLayout, renderMessage } from "@/lib/email";
import type { Invoice } from "@/lib/types/database";

function prettyDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface InvoiceRecipient {
  clerk_user_id: string;
  email: string | null;
  full_name: string | null;
}

/**
 * Who hears about this invoice: the send, the heads-up before it is due, and
 * the overdue reminder. One resolver so all three can never drift apart.
 *
 * An empty recipient_user_ids means everyone on the account. That is what
 * every invoice predating the column carries, and the right answer for a
 * client with one contact.
 *
 * A chosen id that is no longer on the account simply drops out. The account
 * is the source of truth for who exists, and re-adding someone who has left
 * because their id lingers on an old invoice would be worse than silence. If
 * that empties the list, the callers stop rather than quietly falling back to
 * everyone: falling back would email exactly the person who was deselected.
 */
export async function invoiceRecipients(
  supabase: SupabaseClient,
  invoice: Pick<Invoice, "client_id" | "recipient_user_ids">,
): Promise<InvoiceRecipient[]> {
  const { data } = await supabase
    .from("client_users")
    .select("clerk_user_id, email, full_name")
    .eq("client_id", invoice.client_id)
    .eq("role", "client");
  const all = (data as InvoiceRecipient[] | null) ?? [];
  const chosen = invoice.recipient_user_ids ?? [];
  if (chosen.length === 0) return all;
  return all.filter((u) => chosen.includes(u.clerk_user_id));
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
  opts: { adminNotice?: boolean; testTo?: string } = {},
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

  const subject = opts.testTo
    ? `[Test] New invoice ${invoice.invoice_number}`
    : `New invoice ${invoice.invoice_number}`;
  const notifTitle = `New invoice ${invoice.invoice_number} for ${formatMoney(invoice.total)}`;
  const notifBody = `Due ${prettyDate(invoice.due_date)}.`;
  const now = new Date().toISOString();

  if (opts.testTo) {
    const html = emailLayout(
      `New invoice — ${invoice.invoice_number}`,
      messageHtml,
      "View invoice",
      `/invoices/${invoiceId}`,
    );
    await sendEmail({ to: opts.testTo, subject, html });
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
        `New invoice — ${invoice.invoice_number}`,
        messageHtml,
        "View invoice",
        `/invoices/${invoiceId}`,
      );
      await sendEmail({ to: u.email, subject, html });
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
        body: `${formatMoney(invoice.total)} · due ${prettyDate(invoice.due_date)}`,
        link: `/admin/invoices/${invoiceId}`,
        channel: "in_portal",
      });
    }
  }

  // Flip to "sent" only after the email + notifications have been dispatched, so
  // a hard failure mid-send leaves the invoice as a draft. The recurring cron
  // re-attempts the send for an existing un-sent invoice rather than skipping it.
  await supabase
    .from("invoices")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", invoiceId);
}
