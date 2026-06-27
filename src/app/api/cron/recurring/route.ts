import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { sendInvoiceWith } from "@/lib/invoices-send";
import type { Invoice, InvoiceLineItem } from "@/lib/types/database";

export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Today's calendar date in the business timezone (QLD — no daylight saving), so a
// billing day matches what the admin set regardless of the cron's UTC runtime.
function businessToday(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

// Daily reconciliation: for every ACTIVE recurring template that is DUE this month
// and not yet billed, materialise this month's invoice and AUTO-SEND it. "Due" =
// the billing day has arrived (anchor <= today), so a missed cron day self-heals on
// the next run; the unique (recurring_source_id, recurring_period) index keeps it to
// exactly one invoice per template per month.
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const { y, m, d } = businessToday();
  const today = d;
  const period = fmt(new Date(y, m - 1, 1)); // 1st of this month
  const issueStr = fmt(new Date(y, m - 1, d));

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

      const anchor = t.recurring_anchor_day ?? Number(t.issue_date.slice(8, 10));
      const anchorDateStr = fmt(new Date(y, m - 1, anchor)); // this month's billing day
      // Due once the billing day has arrived this month (<= today, so a missed day
      // self-heals on a later run), but never back-bill a period whose billing day
      // predates when the template was set up.
      const dueNow = today >= anchor && anchorDateStr >= t.issue_date.slice(0, 10);
      if (!dueNow) {
        results.push({ template: t.id, status: "not-due" });
        continue;
      }

      const { data: number, error: numErr } = await supabase.rpc("next_invoice_number");
      if (numErr || !number) throw new Error(numErr?.message ?? "no invoice number");

      const due = new Date(y, m - 1, d);
      due.setDate(due.getDate() + terms);

      // Dedup: the unique index makes a repeat insert for (template, period) fail
      // with 23505 — treat that as "already billed this month", not an error.
      const { data: createdInv, error: insErr } = await supabase
        .from("invoices")
        .insert({
          client_id: t.client_id,
          invoice_number: number as unknown as string,
          status: "draft",
          issue_date: issueStr,
          due_date: fmt(due),
          gst_mode: t.gst_mode,
          discount: t.discount,
          discount_label: t.discount_label,
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
        if ((insErr as { code?: string }).code === "23505") {
          // Already created this period. If a prior run created it but never
          // finished sending (still a draft), finish the send now; else it's done.
          const { data: existing } = await supabase
            .from("invoices")
            .select("id, status")
            .eq("recurring_source_id", t.id)
            .eq("recurring_period", period)
            .maybeSingle();
          const ex = existing as { id: string; status: string } | null;
          if (ex && ex.status === "draft") {
            await sendInvoiceWith(supabase, ex.id, { adminNotice: true });
            results.push({ template: t.id, status: "recovered-send" });
          } else {
            results.push({ template: t.id, status: "already-billed" });
          }
        } else {
          results.push({ template: t.id, status: `error:${insErr.message}` });
        }
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
        title: l.title,
        description: l.description,
        quantity: l.quantity,
        unit_amount: l.unit_amount,
        amount: l.amount,
        position: l.position,
      }));
      if (rows.length > 0) await supabase.from("invoice_line_items").insert(rows);

      // Reuse the manual-send path (email, notify, then status -> sent) and add an
      // admin heads-up so the auto-send isn't silent.
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
