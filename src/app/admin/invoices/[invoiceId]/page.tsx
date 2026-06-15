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

  return (
    <InvoiceBuilder bundle={bundle} business={business} pricingItems={pricing} />
  );
}
