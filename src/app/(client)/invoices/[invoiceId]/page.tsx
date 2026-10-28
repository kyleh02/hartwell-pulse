import { notFound, redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getInvoiceBundle, getBusinessSettings } from "@/lib/invoices";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import { PrintButton } from "@/components/invoices/PrintButton";
import { InvoiceAttachments } from "@/components/invoices/InvoiceAttachments";
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
    // The invoice itself stays RLS-scoped, so a client can only load their own.
    getInvoiceBundle(supabase, invoiceId),
    // business_settings is admin-only under RLS, but the invoice letterhead and
    // bank details are meant for the client. Read them with the service role —
    // only invoice-relevant fields are rendered (this is a server component).
    getBusinessSettings(createAdminSupabase()),
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
          <h1 className="text-[26px] leading-[1.05] font-extrabold tracking-[-0.01em] text-pulse-text uppercase sm:text-[30px]">
            Invoice <span className="text-pulse-gold">{bundle.invoice.invoice_number}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={bundle.invoice.status === "paid" ? "success" : "gold"}>
            {bundle.invoice.status}
          </Badge>
          <PrintButton />
        </div>
      </div>
      {/* The documents that came in the email are here too, for the person who
          deleted the email or never got it. */}
      <InvoiceAttachments mode="client" attachments={bundle.attachments ?? []} />
      <InvoiceDocument bundle={bundle} business={business} />
    </div>
  );
}
