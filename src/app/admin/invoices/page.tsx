import Link from "next/link";
import { Receipt, Plus } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { listAdminInvoices } from "@/lib/invoices";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClasses } from "@/components/ui/Button";
import { InvoicesLibrary } from "@/components/invoices/InvoicesLibrary";

export const metadata = { title: "Invoices" };

export default async function AdminInvoicesPage() {
  const supabase = await createServerSupabase();
  const invoices = await listAdminInvoices(supabase);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

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
        <InvoicesLibrary invoices={invoices} today={today} />
      )}
    </div>
  );
}
