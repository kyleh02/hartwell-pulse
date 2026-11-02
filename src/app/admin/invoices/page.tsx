import Link from "next/link";
import { Receipt, Plus } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { listAdminInvoices, getBusinessSettings } from "@/lib/invoices";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClasses } from "@/components/ui/Button";
import { InvoicesLibrary } from "@/components/invoices/InvoicesLibrary";
import { ScheduledInvoices } from "@/components/invoices/ScheduledInvoices";
import { businessToday } from "@/lib/business-time";

export const metadata = { title: "Invoices" };

export default async function AdminInvoicesPage() {
  const supabase = await createServerSupabase();
  const [invoices, business] = await Promise.all([
    listAdminInvoices(supabase),
    getBusinessSettings(supabase),
  ]);

  // Melbourne's date, not the server's. The server is on UTC, which until 10 or
  // 11am local is still on yesterday, so an invoice due yesterday did not read
  // as overdue until late morning.
  const today = businessToday();

  return (
    <div>
      <PageHeader
        label={["Invoices"]}
        title="Invoices"
        description="Every invoice you've sent, in one place. Filter by status, watch what's outstanding, and chase what's overdue."
        actions={
          <Link href="/admin/invoices/new" className={buttonClasses("primary", "md")}>
            <Plus size={16} strokeWidth={2} /> New invoice
          </Link>
        }
      />

      {invoices.length === 0 ? (
        <EmptyState
          icon={<Receipt size={20} strokeWidth={1.75} />}
          title="No invoices yet"
          description="Start one with New invoice. Set your prices and bank details in Settings first."
        />
      ) : (
        <>
          <ScheduledInvoices
            invoices={invoices}
            defaultTerms={business?.payment_terms_days ?? 14}
          />
          <InvoicesLibrary invoices={invoices} today={today} />
        </>
      )}
    </div>
  );
}
