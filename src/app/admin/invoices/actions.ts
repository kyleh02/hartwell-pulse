"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { computeTotals, lineAmount } from "@/lib/invoices-shared";
import { sendInvoiceWith } from "@/lib/invoices-send";
import type { GstMode, InvoiceStatus } from "@/lib/types/database";

async function adminSupabase() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return { supabase: await createServerSupabase(), session };
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

  const { data: number, error: numErr } = await supabase.rpc("next_invoice_number");
  if (numErr || !number) {
    throw new Error(numErr?.message ?? "Could not allocate an invoice number");
  }

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
  discount: number;
  discount_label: string;
  notes: string;
  email_message: string;
  recurring_active: boolean;
  recurring_anchor_day: number;
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

  const totals = computeTotals(input.lines, input.gst_mode, input.discount);
  await supabase
    .from("invoices")
    .update({
      issue_date: input.issue_date,
      due_date: input.due_date,
      gst_mode: input.gst_mode,
      notes: input.notes || null,
      email_message: input.email_message || null,
      recurring_active: input.recurring_active,
      recurring_anchor_day: input.recurring_active
        ? input.recurring_anchor_day
        : null,
      discount: totals.discount,
      discount_label: input.discount_label.trim() || null,
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
  await sendInvoiceWith(supabase, invoiceId);
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

export async function deleteInvoice(invoiceId: string) {
  const { supabase } = await adminSupabase();

  // Only drafts may be deleted. Anything that has been sent to a client (sent,
  // paid, void) is a financial record and must be kept — guard it server-side so
  // it holds even if a stale button slips through on the client.
  const { data: inv } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) throw new Error("Invoice not found");
  if ((inv as { status: InvoiceStatus }).status !== "draft") {
    throw new Error("Only draft invoices can be deleted — sent invoices are kept on record.");
  }

  // Line items are removed by the composite FK's ON DELETE CASCADE.
  const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/invoices");
  redirect("/admin/invoices");
}
