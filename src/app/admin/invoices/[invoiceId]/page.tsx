import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getInvoiceBundle,
  getBusinessSettings,
  listPricingItems,
} from "@/lib/invoices";
import { InvoiceBuilder } from "@/components/invoices/InvoiceBuilder";

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

  return (
    <InvoiceBuilder
      bundle={bundle}
      business={business}
      pricingItems={pricing}
      people={people}
    />
  );
}
