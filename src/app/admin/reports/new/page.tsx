import { createServerSupabase } from "@/lib/supabase/server";
import type { Client } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewReportForm } from "@/components/reports/NewReportForm";

export const metadata = { title: "New report" };

export default async function NewReportPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("clients")
    .select("id, business_name")
    .order("business_name");
  const clients = (data as Pick<Client, "id" | "business_name">[] | null) ?? [];

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div>
      <PageHeader
        label={["Reports", "New"]}
        title="New report"
        description="Pick a client and a month. I'll pull their metrics into a starter report you can shape."
      />
      <NewReportForm clients={clients} defaultMonth={defaultMonth} />
    </div>
  );
}
