import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getInvoiceBundle,
  getBusinessSettings,
  listPricingItems,
} from "@/lib/invoices";
import { InvoiceBuilder } from "@/components/invoices/InvoiceBuilder";
import { DocumentPdf } from "@/components/documents/DocumentPdf";
import { printTokenFor } from "@/lib/print-token";
import type { EmailEvent, InvoiceSend } from "@/lib/types/database";

export const metadata = { title: "Invoice" };

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const supabase = await createServerSupabase();

  const [bundle, business, pricing] = await Promise.all([
    getInvoiceBundle(supabase, invoiceId),
    getBusinessSettings(supabase),
    listPricingItems(supabase),
  ]);
  if (!bundle) notFound();

  // Everyone on the client's account, so the invoice can be pointed at one of
  // them. Ordered by name so the list does not reshuffle between visits.
  const { data: peopleRows } = await supabase
    .from("client_users")
    .select("clerk_user_id, full_name, email")
    .eq("client_id", bundle.invoice.client_id)
    .eq("role", "client")
    .order("full_name");
  const people =
    (peopleRows as
      | { clerk_user_id: string; full_name: string | null; email: string | null }[]
      | null) ?? [];

  // What actually went out, and to whom, each time. Newest first.
  const { data: sendRows } = await supabase
    .from("invoice_sends")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sent_at", { ascending: false });
  const sends = (sendRows as InvoiceSend[] | null) ?? [];

  // Delivery results for those sends. Admin-only under RLS, so this returns
  // nothing at all for anyone else.
  const { data: eventRows } = await supabase
    .from("email_events")
    .select("*")
    .eq("ref_kind", "invoice")
    .eq("ref_id", invoiceId)
    .order("sent_at", { ascending: true });
  const events = (eventRows as EmailEvent[] | null) ?? [];

  // The exact page the renderer photographs, openable in a real browser. Minted
  // here because only the server holds the secret, and good for five minutes.
  const printToken = printTokenFor("invoice", invoiceId);

  return (
    <>
      {/* Above the builder: what goes out with the email is a decision about
          the send, and a draft invoice is exactly when to check it. */}
      <DocumentPdf
        kind="invoice"
        id={bundle.invoice.id}
        pdfName={bundle.invoice.pdf_name}
        pdfUploadedAt={bundle.invoice.pdf_uploaded_at}
        updatedAt={bundle.invoice.updated_at}
        printUrl={
          printToken
            ? `/print/invoice/${invoiceId}?token=${encodeURIComponent(printToken)}`
            : null
        }
      />
      <InvoiceBuilder
        bundle={bundle}
        business={business}
        pricingItems={pricing}
        people={people}
        sends={sends}
        emailEvents={events}
      />
    </>
  );
}
