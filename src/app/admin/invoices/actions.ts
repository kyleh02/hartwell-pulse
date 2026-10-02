"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { computeTotals, lineAmount } from "@/lib/invoices-shared";
import { sendInvoiceWith, invoiceRecipients } from "@/lib/invoices-send";
import {
  planInstalments,
  toCents,
  toDollars,
  type Money,
} from "@/lib/instalments";
import { businessToday } from "@/lib/business-time";
import type { GstMode, Invoice, InvoiceStatus } from "@/lib/types/database";

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
  rate_mode: string;
  hourly_rate: number | null;
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
    /** Null on an unphased invoice. Lines sharing a value render as one phase. */
    phase_position: number | null;
    phase_title: string;
    phase_note: string;
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
      rate_mode: input.rate_mode,
      hourly_rate: input.hourly_rate,
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
      phase_position: l.phase_position,
      // Only meaningful on a phased line, and blanking them on an unphased one
      // keeps a row that was pulled out of a phase from carrying a stale heading.
      phase_title:
        l.phase_position === null ? null : l.phase_title.trim() || null,
      phase_note:
        l.phase_position === null ? null : l.phase_note.trim() || null,
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

/**
 * Move an invoice between states.
 *
 * `paidOn` is the day the money actually landed, as YYYY-MM-DD. Money rarely
 * arrives on the day anyone gets around to recording it, and stamping now() for
 * a payment that came in last week puts the wrong date on the financial record
 * and on anything that reports by month.
 *
 * The write is checked. It used to be ignored, which meant a rejected update
 * left an invoice looking paid on screen until the page was reloaded.
 */
export async function setInvoiceStatus(
  invoiceId: string,
  status: InvoiceStatus,
  paidOn?: string | null,
) {
  const { supabase } = await adminSupabase();
  const patch: Record<string, unknown> = { status };
  if (status === "paid") {
    // Midday local, so the stored instant lands on the intended calendar day
    // whichever side of midnight it is read back in.
    patch.paid_at = paidOn
      ? new Date(`${paidOn}T12:00:00`).toISOString()
      : new Date().toISOString();
  }
  if (status === "sent") patch.paid_at = null;
  const { error } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", invoiceId);
  if (error) throw new Error(`Could not update the invoice: ${error.message}`);
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
/**
 * Attach a PDF to an invoice by hand.
 *
 * The portal makes one itself, so this is the way out when a render fails,
 * times out, or comes out wrong. Same split of names as everywhere else: the
 * client sees the file she was sent, and the storage key is folded to ASCII
 * because nobody sees it and a non-ASCII object key invites trouble.
 */
export async function uploadInvoicePdf(
  formData: FormData,
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const { supabase } = await adminSupabase();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || !invoiceId) {
    return { ok: false, message: "Choose a PDF first." };
  }
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    return { ok: false, message: "That is not a PDF." };
  }

  const { data: row } = await supabase
    .from("invoices")
    .select("client_id, pdf_path")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!row) return { ok: false, message: "That invoice no longer exists." };
  const { client_id: clientId, pdf_path: oldPath } = row as {
    client_id: string;
    pdf_path: string | null;
  };

  const displayName = file.name.replace(/[\\/:*?"<>|]/g, "").trim() || "invoice.pdf";
  const keyName =
    displayName
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-zA-Z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "invoice.pdf";
  const path = `${clientId}/${invoiceId}/pdf/${Date.now()}-${keyName}`;

  const { error: upErr } = await supabase.storage
    .from("pulse-reports")
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (upErr) return { ok: false, message: upErr.message };

  // Checked. An unchecked write on the money path is a fault waiting for an
  // excuse, and this one would leave the invoice pointing at the previous file
  // while the new one sits in storage unused.
  const { error: updErr } = await supabase
    .from("invoices")
    .update({
      pdf_path: path,
      pdf_name: displayName,
      pdf_uploaded_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);
  if (updErr) {
    await supabase.storage.from("pulse-reports").remove([path]);
    return { ok: false, message: updErr.message };
  }

  if (oldPath && oldPath !== path) {
    await supabase.storage.from("pulse-reports").remove([oldPath]);
  }

  revalidatePath(`/admin/invoices/${invoiceId}`);
  return { ok: true, name: displayName };
}

/** Take the PDF off, so the email goes with a link only. */
export async function removeInvoicePdf(
  invoiceId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { supabase } = await adminSupabase();
  const { data: row } = await supabase
    .from("invoices")
    .select("pdf_path")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!row) return { ok: false, message: "That invoice no longer exists." };

  const { error } = await supabase
    .from("invoices")
    .update({ pdf_path: null, pdf_name: null, pdf_uploaded_at: null })
    .eq("id", invoiceId);
  if (error) return { ok: false, message: error.message };

  const path = (row as { pdf_path: string | null }).pdf_path;
  if (path) await supabase.storage.from("pulse-reports").remove([path]);

  revalidatePath(`/admin/invoices/${invoiceId}`);
  return { ok: true };
}

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


export interface SplitPart {
  /** GST inclusive, in dollars, as typed. */
  amount: number;
  due_date: string;
  /**
   * The day this part should issue and email itself, as YYYY-MM-DD. Null means
   * it is not scheduled and goes out by hand, which is the usual choice for the
   * first part.
   */
  send_date: string | null;
}

/**
 * Split an issued invoice into instalments.
 *
 * Each part becomes a real invoice: its own number, its own amount, its own GST,
 * its own due date, its own document and its own reminders. The parent is kept
 * as the record of what was agreed and marked as split, which takes it out of
 * every balance so the same money is never counted twice.
 */
export async function splitInvoice(
  parentId: string,
  parts: SplitPart[],
  note: string,
) {
  const { supabase, session } = await adminSupabase();

  const { data: parentRow, error: readErr } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", parentId)
    .maybeSingle();
  if (readErr) throw new Error(`Could not read the invoice: ${readErr.message}`);
  if (!parentRow) throw new Error("Invoice not found");
  const parent = parentRow as Invoice;

  if (parent.status !== "sent") {
    throw new Error(
      "Only an invoice that has been sent can be split. A draft can just be edited, and a paid or void one is a closed record.",
    );
  }
  if (parent.split_at) throw new Error("This invoice has already been split.");
  if (parent.parent_invoice_id) {
    throw new Error("An instalment cannot itself be split.");
  }
  if (Number(parent.deposit_amount ?? 0) > 0) {
    throw new Error(
      "This invoice already credits a deposit, so splitting it would count that payment twice. Clear the deposit first.",
    );
  }

  // ex = total - GST holds in every GST mode, including inclusive pricing and a
  // discounted invoice, which is why it is derived rather than read off
  // subtotal.
  const totalCents = toCents(parent.total);
  const gstCents = toCents(parent.gst);
  const parentMoney: Money = {
    exCents: totalCents - gstCents,
    gstCents,
    totalCents,
  };

  const plan = planInstalments(
    parentMoney,
    parts.map((p) => toCents(p.amount)),
  );
  if (plan.problem) throw new Error(plan.problem);

  const count = parts.length;
  const inclusive = parent.gst_mode === "inclusive";
  const today = businessToday();
  const made: string[] = [];

  for (let i = 0; i < count; i++) {
    const part = parts[i];
    const money = plan.parts[i];
    const n = i + 1;
    // On an inclusive invoice the line amounts and the subtotal are themselves
    // GST inclusive, so the line has to be stated the same way the parent was or
    // the document would contradict its own totals.
    const lineAmountDollars = toDollars(
      inclusive ? money.totalCents : money.exCents,
    );

    const { data: created, error: insErr } = await supabase
      .from("invoices")
      .insert({
        client_id: parent.client_id,
        // Suffixed rather than taken from the sequence, so the relationship is
        // legible on the document itself and in a bank statement line.
        invoice_number: `${parent.invoice_number}-${n}`,
        status: "draft",
        issue_date: part.send_date ?? today,
        due_date: part.due_date,
        brand: parent.brand,
        gst_mode: parent.gst_mode,
        rate_mode: "fixed",
        subtotal: lineAmountDollars,
        discount: 0,
        gst: toDollars(money.gstCents),
        total: toDollars(money.totalCents),
        recipient_user_ids: parent.recipient_user_ids ?? [],
        parent_invoice_id: parent.id,
        instalment_number: n,
        instalment_count: count,
        scheduled_send_at: part.send_date,
        // Written now rather than at send time, so what the client will receive
        // is visible on the invoice before it goes anywhere. It has to read as
        // the arranged part of something already agreed: he has seen an invoice
        // for the whole amount, and a second document for half of it with no
        // context invites the question of whether he now owes one and a half
        // times the job.
        email_message:
          `Hi {client},

` +
          `As agreed, here is part ${n} of ${count} of invoice ${parent.invoice_number}, for {amount}, due {due date}.

` +
          `This is the agreed instalment of that invoice, not a new charge on top of it. The breakdown is on the invoice itself.

` +
          `Thanks,
Kyle`,
        created_by: session.clerkUserId,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`Could not create instalment ${n}: ${insErr.message}`);
    const id = (created as { id: string }).id;
    made.push(id);

    const { error: lineErr } = await supabase.from("invoice_line_items").insert({
      invoice_id: id,
      client_id: parent.client_id,
      title: `Instalment ${n} of ${count} of invoice ${parent.invoice_number}`,
      description: `Agreed split of invoice ${parent.invoice_number}. This is part ${n} of ${count}, not an additional charge.`,
      quantity: 1,
      unit_amount: lineAmountDollars,
      amount: lineAmountDollars,
      position: 0,
    });
    if (lineErr) throw new Error(`Could not write instalment ${n}: ${lineErr.message}`);
  }

  const { error: markErr } = await supabase
    .from("invoices")
    .update({
      split_at: new Date().toISOString(),
      split_note: note.trim() || null,
      split_by: session.clerkUserId,
    })
    .eq("id", parentId);
  if (markErr) throw new Error(`Could not mark the invoice as split: ${markErr.message}`);

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${parentId}`);
  return made;
}
