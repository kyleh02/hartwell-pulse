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
    .select("client_id, invoice_number, pdf_path, clients(business_name)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!row) return { ok: false, message: "That invoice no longer exists." };
  const invoice = row as {
    client_id: string;
    invoice_number: string | null;
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
  });
}
