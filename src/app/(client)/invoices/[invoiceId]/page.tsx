import { notFound, redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getInvoiceBundle, getBusinessSettings } from "@/lib/invoices";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import { PrintButton } from "@/components/invoices/PrintButton";
import { Badge } from "@/components/ui/Badge";

export const metadata = { title: "Invoice" };

export default async function ClientInvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const [bundle, business] = await Promise.all([
    getInvoiceBundle(supabase, invoiceId),
    getBusinessSettings(supabase),
  ]);

  if (
    !bundle ||
    bundle.invoice.client_id !== session.clientId ||
    bundle.invoice.status === "draft"
  ) {
    notFound();
  }

  return (
    <div>
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mono-label">{bundle.invoice.invoice_number}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-pulse-text">
            Invoice
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={bundle.invoice.status === "paid" ? "success" : "gold"}>
            {bundle.invoice.status}
          </Badge>
          <PrintButton />
        </div>
      </div>
      <InvoiceDocument bundle={bundle} business={business} />
    </div>
  );
}
