import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import type { Invoice, InvoiceLineItem } from "@/lib/types/database";

export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Monthly: clone each recurring template (a recurring invoice from a previous
// month) into a fresh DRAFT for this month, and hand the "recurring" flag to
// the new draft. Run on the 1st (see vercel.json).
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const now = new Date();
  const firstOfMonth = fmt(new Date(now.getFullYear(), now.getMonth(), 1));

  const { data: templates } = await supabase
    .from("invoices")
    .select("*")
    .eq("recurring", true)
    .lt("issue_date", firstOfMonth);
  const list = (templates as Invoice[] | null) ?? [];

  const { data: settings } = await supabase
    .from("business_settings")
    .select("payment_terms_days")
    .eq("id", 1)
    .maybeSingle();
  const terms = (settings as { payment_terms_days?: number } | null)?.payment_terms_days ?? 14;

  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true });
  let next = count ?? 0;
  let created = 0;

  for (const t of list) {
    next += 1;
    const number = `INV-${String(next).padStart(4, "0")}`;
    const due = new Date(now);
    due.setDate(due.getDate() + terms);

    const { data: createdInv } = await supabase
      .from("invoices")
      .insert({
        client_id: t.client_id,
        invoice_number: number,
        status: "draft",
        issue_date: fmt(now),
        due_date: fmt(due),
        gst_mode: t.gst_mode,
        subtotal: t.subtotal,
        gst: t.gst,
        total: t.total,
        notes: t.notes,
        recurring: true,
        created_by: t.created_by,
      })
      .select("id")
      .single();

    if (createdInv) {
      const newId = (createdInv as { id: string }).id;
      const { data: lines } = await supabase
        .from("invoice_line_items")
        .select("*")
        .eq("invoice_id", t.id);
      const rows = ((lines as InvoiceLineItem[] | null) ?? []).map((l) => ({
        invoice_id: newId,
        client_id: t.client_id,
        description: l.description,
        quantity: l.quantity,
        unit_amount: l.unit_amount,
        amount: l.amount,
        position: l.position,
      }));
      if (rows.length > 0) await supabase.from("invoice_line_items").insert(rows);
      await supabase.from("invoices").update({ recurring: false }).eq("id", t.id);
      created += 1;
    }
  }

  return Response.json({ created });
}
