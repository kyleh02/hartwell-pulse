"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { computeTotals, lineAmount, formatMoney } from "@/lib/invoices-shared";
import { sendEmail, emailLayout } from "@/lib/email";
import type { GstMode, Invoice, InvoiceStatus } from "@/lib/types/database";

async function adminSupabase() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return { supabase: await createServerSupabase(), session };
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prettyDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function createInvoice(clientId: string) {
  const { supabase, session } = await adminSupabase();

  const { data: settings } = await supabase
    .from("business_settings")
    .select("payment_terms_days, gst_mode")
    .eq("id", 1)
    .maybeSingle();
  const terms = (settings as { payment_terms_days?: number } | null)?.payment_terms_days ?? 14;
  const gstMode = ((settings as { gst_mode?: GstMode } | null)?.gst_mode ?? "add") as GstMode;

  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true });
  const number = `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const issue = new Date();
  const due = new Date(issue);
  due.setDate(due.getDate() + terms);

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      client_id: clientId,
      invoice_number: number,
      status: "draft",
      issue_date: fmtDate(issue),
      due_date: fmtDate(due),
      gst_mode: gstMode,
      created_by: session.clerkUserId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create invoice");

  redirect(`/admin/invoices/${(data as { id: string }).id}`);
}

export interface SaveInvoiceInput {
  issue_date: string;
  due_date: string;
  gst_mode: GstMode;
  notes: string;
  recurring: boolean;
  lines: { description: string; quantity: number; unit_amount: number }[];
}

export async function saveInvoice(invoiceId: string, input: SaveInvoiceInput) {
  const { supabase } = await adminSupabase();
  const { data: inv } = await supabase
    .from("invoices")
    .select("client_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) throw new Error("Invoice not found");
  const clientId = (inv as { client_id: string }).client_id;

  const totals = computeTotals(input.lines, input.gst_mode);
  await supabase
    .from("invoices")
    .update({
      issue_date: input.issue_date,
      due_date: input.due_date,
      gst_mode: input.gst_mode,
      notes: input.notes || null,
      recurring: input.recurring,
      subtotal: totals.subtotal,
      gst: totals.gst,
      total: totals.total,
    })
    .eq("id", invoiceId);

  await supabase.from("invoice_line_items").delete().eq("invoice_id", invoiceId);
  if (input.lines.length > 0) {
    const rows = input.lines.map((l, i) => ({
      invoice_id: invoiceId,
      client_id: clientId,
      description: l.description,
      quantity: l.quantity,
      unit_amount: l.unit_amount,
      amount: lineAmount(l),
      position: i,
    }));
    const { error } = await supabase.from("invoice_line_items").insert(rows);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/admin/invoices/${invoiceId}`);
}

export async function sendInvoice(invoiceId: string) {
  const { supabase } = await adminSupabase();
  const { data: inv } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) throw new Error("Invoice not found");
  const invoice = inv as Invoice;

  await supabase
    .from("invoices")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", invoiceId);

  const { data: users } = await supabase
    .from("client_users")
    .select("clerk_user_id, email")
    .eq("client_id", invoice.client_id)
    .eq("role", "client");

  const title = `New invoice ${invoice.invoice_number} for ${formatMoney(invoice.total)}`;
  const body = `Due ${prettyDate(invoice.due_date)}.`;
  const now = new Date().toISOString();

  for (const u of (users as { clerk_user_id: string; email: string | null }[] | null) ?? []) {
    // notification, marked emailed because we send the email here directly
    await supabase.from("notifications").insert({
      recipient_user_id: u.clerk_user_id,
      client_id: invoice.client_id,
      type: "invoice",
      title,
      body,
      link: `/invoices/${invoiceId}`,
      channel: "instant",
      emailed_at: now,
    });
    if (u.email) {
      const html = emailLayout(
        `New invoice — ${invoice.invoice_number}`,
        `<p>Hi,</p><p>A new invoice for <strong>${formatMoney(invoice.total)}</strong> is ready in your portal, due on ${prettyDate(invoice.due_date)}.</p>`,
        "View invoice",
        `/invoices/${invoiceId}`,
      );
      await sendEmail({ to: u.email, subject: title, html });
    }
  }

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
}

export async function setInvoiceStatus(invoiceId: string, status: InvoiceStatus) {
  const { supabase } = await adminSupabase();
  const patch: Record<string, unknown> = { status };
  if (status === "paid") patch.paid_at = new Date().toISOString();
  await supabase.from("invoices").update(patch).eq("id", invoiceId);
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
}
