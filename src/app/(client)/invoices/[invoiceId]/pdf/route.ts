import { type NextRequest } from "next/server";
import type { Invoice } from "@/lib/types/database";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { invoicePdfIsCurrent, renderInvoicePdf } from "@/lib/invoice-pdf";

export const runtime = "nodejs";
// Room for a cold Chromium start, for the times the PDF has to be made first.
export const maxDuration = 60;

/**
 * The invoice's PDF, for the client it belongs to.
 *
 * This is what Download PDF hands over: the portal's own PDF, fitted to its
 * pages, the same file the email carried. It used to print the screen, which
 * paginates the same way but cannot shrink an invoice that spills a line onto
 * page two, and on a phone gives whatever the browser's print sheet makes of it.
 *
 * The invoice is read as the client first, so RLS decides whether they may
 * have it at all (their own, never a draft). If the stored file no longer
 * shows the invoice as it stands (see invoicePdfIsCurrent), or there is none,
 * it is made now, exactly as the editor makes it. Then a one-minute signed URL
 * goes back, so no lasting link to the file ever sits in a page.
 *
 * JSON rather than a redirect, because making the file can take twenty seconds
 * and the button needs to say so while it waits. ok: false tells the button to
 * fall back to printing the page, which always works.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const session = await getPulseSession();
  if (!session?.clientId) return Response.json({ ok: false }, { status: 401 });
  const { invoiceId } = await params;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  const invoice = data as Invoice | null;
  if (!invoice || invoice.client_id !== session.clientId || invoice.status === "draft") {
    return Response.json({ ok: false }, { status: 404 });
  }

  const admin = createAdminSupabase();
  let path = invoice.pdf_path;
  let name = invoice.pdf_name;
  if (!invoicePdfIsCurrent(invoice)) {
    // The address the renderer opens: the configured one first, the request's
    // own for a preview deployment. Same rule as /api/invoices/[id]/pdf.
    const origin =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || req.nextUrl.origin;
    const made = await renderInvoicePdf(admin, invoiceId, origin);
    if (!made.ok) {
      console.warn(`[invoice ${invoiceId}] client PDF: ${made.message}`);
      return Response.json({ ok: false });
    }
    path = made.path;
    name = made.name;
  }
  if (!path) return Response.json({ ok: false });

  const { data: signed, error } = await admin.storage
    .from("pulse-reports")
    .createSignedUrl(path, 60, {
      download: name || `${invoice.invoice_number ?? "Invoice"}.pdf`,
    });
  if (error || !signed?.signedUrl) return Response.json({ ok: false });
  return Response.json({ ok: true, url: signed.signedUrl });
}
