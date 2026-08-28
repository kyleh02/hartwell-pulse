import { notFound } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getInvoiceBundle, getBusinessSettings } from "@/lib/invoices";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import { printTokenValid } from "@/lib/print-token";
import { ForcePrintLight } from "@/components/reports/ForcePrintLight";

/**
 * The page the PDF renderer opens for an invoice. Not for people.
 *
 * A headless browser has no Clerk session and cannot be given one, so it
 * cannot open the client's invoice page. This is the same document, reachable
 * without a login, guarded by a signed token scoped to this one invoice id and
 * good for five minutes.
 *
 * It renders the identical `InvoiceDocument` the client sees. A print-only
 * twin would be two documents to keep in step, and the PDF would drift from
 * the portal the first time only one of them changed. That matters more on an
 * invoice than anywhere else: the attachment and the portal have to agree on
 * the amount.
 *
 * Service-role Supabase, because there is no session to scope RLS with. The
 * token IS the access check, which is why it is signed, short-lived and bound
 * to the kind as well as the id.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const supabase = createAdminSupabase();
  const bundle = await getInvoiceBundle(supabase, invoiceId);
  return {
    title: bundle
      ? `${bundle.client.business_name} - Invoice ${bundle.invoice.invoice_number ?? ""}`.trim()
      : "Invoice",
  };
}

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { invoiceId } = await params;
  const { token } = await searchParams;

  // notFound rather than a message: an unsigned request should not learn
  // whether the id it guessed exists.
  if (!printTokenValid("invoice", invoiceId, token)) notFound();

  const supabase = createAdminSupabase();
  const [bundle, business] = await Promise.all([
    getInvoiceBundle(supabase, invoiceId),
    getBusinessSettings(supabase),
  ]);
  if (!bundle) notFound();

  return (
    <div data-invoice-print-ready="1">
      <ForcePrintLight />
      <InvoiceDocument bundle={bundle} business={business} />
    </div>
  );
}
