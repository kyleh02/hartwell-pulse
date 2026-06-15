import { createServerSupabase } from "@/lib/supabase/server";
import type { Client } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewInvoiceForm } from "@/components/invoices/NewInvoiceForm";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("clients")
    .select("id, business_name")
    .order("business_name");
  const clients = (data as Pick<Client, "id" | "business_name">[] | null) ?? [];

  return (
    <div>
      <PageHeader
        label={["Invoices", "New"]}
        title="New invoice"
        description="Pick a client. I'll create a draft with your default terms and GST, ready for you to add lines."
      />
      <NewInvoiceForm clients={clients} />
    </div>
  );
}
