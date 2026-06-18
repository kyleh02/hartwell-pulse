import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { sendInvoiceWith } from "@/lib/invoices-send";
import type { Invoice, InvoiceLineItem } from "@/lib/types/database";

export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Daily reconciliation: for every ACTIVE recurring template whose billing day is
// today, materialise this month's invoice and AUTO-SEND it. Idempotent — the
// unique (recurring_source_id, recurring_period) index means a duplicate or
// retried run can never double-bill, and a missed day self-heals the next day.
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
  const today = now.getDate();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const period = fmt(new Date(now.getFullYear(), now.getMonth(), 1)); // 1st of this month

  // Active templates + their client's lifecycle state (inner join on the client).
  const { data: templates, error: tErr } = await supabase
    .from("invoices")
    .select("*, clients!inner(status, deleted_at)")
    .eq("recurring_active", true);
  if (tErr) {
    return new Response(`Could not list recurring templates: ${tErr.message}`, {
      status: 500,
    });
  }
  const list =
    (templates as
      | (Invoice & { clients: { status: string; deleted_at: string | null } })[]
      | null) ?? [];

  const { data: settings } = await supabase
    .from("business_settings")
    .select("payment_terms_days")
    .eq("id", 1)
    .maybeSingle();
  const terms =
    (settings as { payment_terms_days?: number } | null)?.payment_terms_days ?? 14;

  const results: { template: string; status: string }[] = [];

  for (const t of list) {
    try {
      // Lifecycle guard: never bill an offboarded client.
      if (t.clients.deleted_at || t.clients.status === "paused") {
        results.push({ template: t.id, status: "skipped-client-not-billable" });
        continue;
      }

      // Billing-day check, with a last-day fallback so an anchor never overshoots
      // a short month (shouldn't happen given the 1..28 cap, but safe).
      const anchor = t.recurring_anchor_day ?? Number(t.issue_date.slice(8, 10));
      const dueToday = anchor === today || (today === lastDay && anchor > lastDay);
      if (!dueToday) {
        results.push({ template: t.id, status: "not-due-today" });
        continue;
      }

      const { data: number, error: numErr } = await supabase.rpc("next_invoice_number");
      if (numErr || !number) throw new Error(numErr?.message ?? "no invoice number");

      const due = new Date(now);
      due.setDate(due.getDate() + terms);

      // Dedup: the unique index makes a repeat insert for (template, period) fail
      // with 23505 — treat that as "already billed this month", not an error.
      const { data: createdInv, error: insErr } = await supabase
        .from("invoices")
        .insert({
          client_id: t.client_id,
          invoice_number: number as unknown as string,
          status: "draft",
          issue_date: fmt(now),
          due_date: fmt(due),
          gst_mode: t.gst_mode,
          subtotal: t.subtotal,
          gst: t.gst,
          total: t.total,
          notes: t.notes,
          email_message: t.email_message,
          created_by: t.created_by,
          recurring_source_id: t.id,
          recurring_period: period,
        })
        .select("id")
        .single();

      if (insErr) {
        results.push({
          template: t.id,
          status:
            (insErr as { code?: string }).code === "23505"
              ? "already-billed"
              : `error:${insErr.message}`,
        });
        continue;
      }

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

      // Reuse the exact manual-send path (status -> sent, email, notify) and add
      // an admin heads-up so the auto-send isn't silent.
      await sendInvoiceWith(supabase, newId, { adminNotice: true });
      results.push({ template: t.id, status: "sent" });
    } catch (e) {
      results.push({
        template: t.id,
        status: `error:${e instanceof Error ? e.message : "failed"}`,
      });
    }
  }

  return Response.json({ period, processed: results });
}
