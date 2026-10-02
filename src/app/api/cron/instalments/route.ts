import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { businessToday } from "@/lib/business-time";
import { sendInvoiceWith } from "@/lib/invoices-send";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import type { Invoice } from "@/lib/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A route handler, so it may take a minute. Rendering a PDF needs more than the
// ten seconds a server action gets, and a cold browser start does not finish in
// ten.
export const maxDuration = 60;

/**
 * Issue and email the instalments whose day has arrived.
 *
 * An instalment sits as a draft carrying scheduled_send_at until that date, then
 * goes out on its own.
 *
 * The date is read in the business timezone, not UTC. Melbourne is UTC+11 on
 * daylight saving, so a job reading a UTC date between local midnight and 11am
 * is still on yesterday and would send a day late.
 */
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const today = businessToday();

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .not("parent_invoice_id", "is", null)
    .eq("status", "draft")
    .not("scheduled_send_at", "is", null)
    .lte("scheduled_send_at", today)
    .order("scheduled_send_at");
  if (error) {
    return new Response(`Could not list instalments: ${error.message}`, {
      status: 500,
    });
  }
  const due = (data as Invoice[] | null) ?? [];
  const results: { invoice: string; status: string }[] = [];

  for (const inv of due) {
    const label = inv.invoice_number ?? inv.id;
    try {
      // CLAIM FIRST, SEND SECOND.
      //
      // The claim is an insert against a unique index, so a retry, a replay or
      // an overlapping run loses the race and is told so by the database with a
      // 23505. Reading a timestamp and deciding not to send leaves a gap between
      // the read and the write, and two runs can both read "not sent yet" inside
      // it. An invoice emailed twice cannot be taken back: the client has seen
      // it.
      const { error: claimErr } = await supabase.from("invoice_sends").insert({
        invoice_id: inv.id,
        client_id: inv.client_id,
        revision: inv.revision ?? 0,
        total: inv.total,
        due_date: inv.due_date,
        sent_to: [],
        kind: "scheduled",
      });
      if (claimErr) {
        const code = (claimErr as { code?: string }).code;
        results.push({
          invoice: label,
          status: code === "23505" ? "already-claimed" : `claim-failed:${claimErr.message}`,
        });
        continue;
      }

      // Best effort, exactly as the recurring cron treats it: an instalment that
      // arrives with a link instead of an attachment is a small loss, and one
      // that does not arrive is a client who does not pay.
      const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
      if (origin) {
        try {
          const res = await renderInvoicePdf(supabase, inv.id, origin);
          if (!res.ok) console.warn(`[instalments ${label}] PDF: ${res.message}`);
        } catch (e) {
          console.warn(`[instalments ${label}] PDF threw: ${String(e)}`);
        }
      }

      await sendInvoiceWith(supabase, inv.id, { adminNotice: true });
      results.push({ invoice: label, status: "sent" });
    } catch (e) {
      results.push({
        invoice: label,
        status: `error:${e instanceof Error ? e.message : "failed"}`,
      });
    }
  }

  return Response.json({ today, due: due.length, results });
}
