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

/**
 * Mark an invoice as sent, email it to the client, and create the in-portal
 * notification. Works with either the RLS server client (manual "Send" button)
 * or the service-role client (the recurring cron) — it only takes a client + id.
 *
 * opts.adminNotice=true also drops an in-portal heads-up to the admin(s), used by
 * the recurring auto-send so a machine never bills a client silently.
 */
export async function sendInvoiceWith(
  supabase: SupabaseClient,
  invoiceId: string,
  opts: { adminNotice?: boolean } = {},
): Promise<void> {
  const { data: inv } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) throw new Error("Invoice not found");
  const invoice = inv as Invoice;

  const [{ data: clientRow }, { data: settings }, { data: users }] =
    await Promise.all([
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
      supabase
        .from("client_users")
        .select("clerk_user_id, email")
        .eq("client_id", invoice.client_id)
        .eq("role", "client"),
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

  const subject = `New invoice ${invoice.invoice_number}`;
  const notifTitle = `New invoice ${invoice.invoice_number} for ${formatMoney(invoice.total)}`;
  const notifBody = `Due ${prettyDate(invoice.due_date)}.`;
  const now = new Date().toISOString();

  for (const u of (users as { clerk_user_id: string; email: string | null }[] | null) ?? []) {
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
