"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { computeTotals, lineAmount } from "@/lib/invoices-shared";
import { sendInvoiceWith, invoiceRecipients } from "@/lib/invoices-send";
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

  // Start from whoever the last invoice for this client actually went to.
  // Billing a two-person account usually means billing the same one of them
  // every month, and having to remember that each time is how the wrong person
  // gets an invoice. It is only a starting point: the picker on the invoice
  // shows everyone on the account, so a new contact is visibly unticked rather
  // than silently left out.
  const { data: lastRow } = await supabase
    .from("invoices")
    .select("recipient_user_ids")
    .eq("client_id", clientId)
    .neq("status", "void")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const inherited =
    (lastRow as { recipient_user_ids: string[] | null } | null)
      ?.recipient_user_ids ?? [];

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      client_id: clientId,
      invoice_number: number,
      status: "draft",
      issue_date: fmtDate(issue),
      due_date: fmtDate(due),
      gst_mode: gstMode,
      recipient_user_ids: inherited,
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
  brand: string;
  deposit_amount: number;
  deposit_label: string;
  gst_mode: GstMode;
  recipient_user_ids: string[];
  notes: string;
  email_message: string;
  recurring_active: boolean;
  recurring_anchor_day: number;
  recurring_terms_days: number | null;
  lines: {
    title: string;
    description: string;
    quantity: number;
    unit_amount: number;
  }[];
}

export async function saveInvoice(invoiceId: string, input: SaveInvoiceInput) {
  const { supabase } = await adminSupabase();
  const { data: inv } = await supabase
    .from("invoices")
    .select("client_id, status, revision")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) throw new Error("Invoice not found");
  const current = inv as {
    client_id: string;
    status: InvoiceStatus;
    revision: number | null;
  };
  const clientId = current.client_id;

  // A sent invoice may be corrected and reissued under the same number, which
  // is the ordinary thing to do for one that has not been paid. Paid and void
  // are closed records: a paid invoice is what the money was against, and a
  // void one exists precisely to preserve what was cancelled. Guarded here as
  // well as in the UI, because a rule that lives only in a disabled button is
  // not a rule.
  if (current.status === "paid" || current.status === "void") {
    throw new Error(
      `A ${current.status} invoice cannot be edited. Reopen it first if it is not actually ${current.status}.`,
    );
  }

  // Revision 0 is the invoice as first issued. Every correction after it has
  // gone out bumps it, so the send log can say which version landed where.
  const revision =
    current.status === "sent"
      ? (current.revision ?? 0) + 1
      : (current.revision ?? 0);

  const totals = computeTotals(input.lines, input.gst_mode);
  // This update MUST be checked. It was not, and a rejected write here is
  // invisible and expensive: the invoice keeps its empty defaults, the send
  // that follows reads those defaults back, and the client receives a $0
  // invoice on the wrong terms. Fail loudly instead.
  const { error: invErr } = await supabase
    .from("invoices")
    .update({
      issue_date: input.issue_date,
      due_date: input.due_date,
      brand: input.brand,
      deposit_amount: input.deposit_amount,
      deposit_label: input.deposit_label || null,
      gst_mode: input.gst_mode,
      recipient_user_ids: input.recipient_user_ids,
      revision,
      notes: input.notes || null,
      email_message: input.email_message || null,
      recurring_active: input.recurring_active,
      recurring_anchor_day: input.recurring_active
        ? input.recurring_anchor_day
        : null,
      recurring_terms_days: input.recurring_active
        ? input.recurring_terms_days
        : null,
      discount: totals.discount,
      subtotal: totals.subtotal,
      gst: totals.gst,
      total: totals.total,
    })
    .eq("id", invoiceId);
  if (invErr) throw new Error(`Could not save the invoice: ${invErr.message}`);

  const { error: delErr } = await supabase
    .from("invoice_line_items")
    .delete()
    .eq("invoice_id", invoiceId);
  if (delErr) throw new Error(`Could not save the invoice: ${delErr.message}`);
  if (input.lines.length > 0) {
    const rows = input.lines.map((l, i) => ({
      invoice_id: invoiceId,
      client_id: clientId,
      title: l.title.trim() || null,
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

/**
 * Email an already-sent invoice again, to whoever is currently chosen on it.
 *
 * The same number, corrected. That is the normal fix for an unpaid invoice
 * that was wrong, and it beats voiding it and raising a new number, which
 * leaves the client holding two documents for one job.
 *
 * A paid invoice is not resent from here: if the numbers changed on something
 * already paid, that is a credit or a fresh invoice, not a quiet reissue.
 */
export async function resendInvoice(
  invoiceId: string,
): Promise<{ ok: true; sentTo: string[] } | { ok: false; message: string }> {
  const { supabase } = await adminSupabase();

  const { data: row } = await supabase
    .from("invoices")
    .select("status, recipient_user_ids, client_id")
    .eq("id", invoiceId)
    .maybeSingle();
  const inv = row as {
    status: InvoiceStatus;
    recipient_user_ids: string[] | null;
    client_id: string;
  } | null;
  if (!inv) return { ok: false, message: "Invoice not found." };
  if (inv.status !== "sent") {
    return {
      ok: false,
      message:
        inv.status === "draft"
          ? "This invoice has not been sent yet. Use Send."
          : `A ${inv.status} invoice is not resent. Raise a new one instead.`,
    };
  }

  const people = await invoiceRecipients(supabase, {
    client_id: inv.client_id,
    recipient_user_ids: inv.recipient_user_ids ?? [],
  });
  if (people.length === 0) {
    return {
      ok: false,
      message:
        "No one on this account is set to receive this invoice. Choose a recipient under Send to, then try again.",
    };
  }

  try {
    await sendInvoiceWith(supabase, invoiceId, { resend: true });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not resend.",
    };
  }

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  return {
    ok: true,
    sentTo: people.map((p) => p.email).filter((e): e is string => Boolean(e)),
  };
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

/**
 * Send the invoice email to yourself, exactly as the client would receive it.
 *
 * Reads the saved row, like the real send does, so a proof shows what is
 * actually stored rather than what is on screen. If the numbers look wrong in
 * the test, they are wrong in the database.
 */
export async function sendTestInvoice(invoiceId: string): Promise<string> {
  const { supabase, session } = await adminSupabase();

  const { data: me } = await supabase
    .from("client_users")
    .select("email")
    .eq("clerk_user_id", session.clerkUserId)
    .maybeSingle();
  const to = (me as { email: string | null } | null)?.email;
  if (!to) {
    throw new Error(
      "No email address on your own user record, so there is nowhere to send the test.",
    );
  }

  await sendInvoiceWith(supabase, invoiceId, { testTo: to });
  return to;
}
