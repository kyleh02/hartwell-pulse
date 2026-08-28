import { PageHeader } from "@/components/ui/PageHeader";
import { createServerSupabase } from "@/lib/supabase/server";
import { listWork, getWorkStrip } from "@/lib/work";
import { WorkStrip } from "@/components/work/WorkStrip";
import { WorkDashboard } from "@/components/work/WorkDashboard";
import type { Client } from "@/lib/types/database";

export const metadata = { title: "Dashboard" };

/**
 * The dashboard, rebuilt on work items.
 *
 * It used to read `board_cards` and nothing else, which is why it was never
 * opened: the work lived in the CRM, the invoices and the reports, and none of
 * it reached this page. Now everything is a work item and this is the only
 * place that has to be looked at.
 *
 * Nothing is cached. A list of what to do next that is thirty seconds stale is
 * a list that gets doubted, and doubting it is the end of using it.
 */
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const supabase = await createServerSupabase();
  // Closed rows come too, so the Done view can show them and a mis-tick has a
  // way back. The list filters them out; nothing else has to know.
  const [rows, strip, { data: clientData }] = await Promise.all([
    listWork(supabase, { includeClosed: true }),
    getWorkStrip(supabase),
    supabase.from("clients").select("id, business_name").order("business_name"),
  ]);

  const clients =
    (clientData as Pick<Client, "id" | "business_name">[] | null) ?? [];

  return (
    <div>
      <PageHeader
        label={["Command", "Overview"]}
        title="Dashboard"
        description="Everything you owe someone, in one list. Tick it, snooze it, or say you are not doing it."
      />
      <WorkStrip strip={strip} />
      <WorkDashboard rows={rows} clients={clients} />
    </div>
  );
}
