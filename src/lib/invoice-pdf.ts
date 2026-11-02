import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderAndAttach, type RenderPdfResult } from "@/lib/pdf-render";

export type { RenderPdfResult };

/**
 * Render an invoice to PDF and attach it to the invoice.
 *
 * Same machinery as the report version and two deliberate differences, both
 * following from what an invoice is.
 *
 * An invoice has no publish step. A report is written, published and then sent,
 * so the render hangs on publish and never touches the send. An invoice goes
 * draft to sent in one move, so this is called on demand from the editor and
 * again by the send if nothing is attached yet.
 *
 * And an invoice can be sent with nobody watching, by the recurring cron. That
 * inverts the report's rule about a failed render: a report send stops and says
 * why, because someone is there to read it. An invoice send never stops, because
 * an invoice that does not arrive is worse than one that arrives with a link
 * instead of an attachment, and nobody is watching to fix it.
 *
 * The filename is the invoice number rather than a title. It is what a client
 * files it under, what they quote back in an email about it, and what a
 * bookkeeper searches for.
 */
export async function renderInvoicePdf(
  supabase: SupabaseClient,
  invoiceId: string,
  origin: string,
): Promise<RenderPdfResult> {
  const { data: row } = await supabase
    .from("invoices")
    .select("client_id, invoice_number, revision, pdf_path, clients(business_name)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!row) return { ok: false, message: "That invoice no longer exists." };
  const invoice = row as {
    client_id: string;
    invoice_number: string | null;
    revision: number | null;
    pdf_path: string | null;
    clients: { business_name: string } | { business_name: string }[] | null;
  };
  const client = Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients;

  return renderAndAttach({
    supabase,
    kind: "invoice",
    id: invoiceId,
    table: "invoices",
    clientId: invoice.client_id,
    // "Hartwell Digital Invoice INV-0042" reads correctly in an inbox and
    // sorts sensibly in a downloads folder.
    rawName: `${client?.business_name ?? "Invoice"} Invoice ${invoice.invoice_number ?? ""}`,
    fallbackName: "Invoice",
    previousPath: invoice.pdf_path,
    origin,
    // An invoice that spills a few lines onto a second page is shrunk a
    // touch to fit on one. See fitToFewerPages.
    fit: true,
    // Which version of the invoice the file shows. See invoicePdfIsCurrent.
    folder: `r${invoice.revision ?? 0}`,
  });
}

/**
 * Whether the stored PDF shows the invoice as it stands now, so the client's
 * Download PDF can hand it over instead of making a new one.
 *
 * A PDF uploaded by hand is Kyle's own document and the one the email carried,
 * and nothing ever renders over it, so it always counts. A generated one counts
 * only when it was made from the current revision, which renderInvoicePdf
 * records as a folder in its path (`pdf/r2/...`). Saving a correction to a sent
 * invoice bumps the revision, so a correction saved without a resend leaves the
 * file showing the old figures, and this catches it. updated_at cannot: the
 * send and marking paid bump it too, so every PDF would look stale.
 *
 * A file made before the folder existed (2 November 2026) never counts, which
 * also retires the PDFs made in the invoice's old design.
 */
export function invoicePdfIsCurrent(invoice: {
  pdf_path: string | null;
  pdf_source?: string | null;
  revision: number | null;
}): boolean {
  if (!invoice.pdf_path) return false;
  if (invoice.pdf_source === "uploaded") return true;
  const made = invoice.pdf_path.match(/\/pdf\/r(\d+)\//);
  return made !== null && Number(made[1]) === (invoice.revision ?? 0);
}
