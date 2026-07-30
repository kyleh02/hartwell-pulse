import { Target } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCrmMetrics,
  getCrmSettings,
  listCrmLists,
  listDueTasks,
  listProspects,
} from "@/lib/crm";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { CrmHealth } from "@/components/crm/CrmHealth";
import { PipelineView } from "@/components/crm/PipelineView";
import { ImportProspects } from "@/components/crm/ImportProspects";

export const metadata = { title: "Pipeline" };

export default async function AdminCrmPage() {
  const supabase = await createServerSupabase();

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [rows, metrics, settings, dueTasks, lists] = await Promise.all([
    listProspects(supabase),
    getCrmMetrics(supabase, 7),
    getCrmSettings(supabase),
    listDueTasks(supabase, today),
    listCrmLists(supabase),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        label={["Ironpeak", "Outreach"]}
        title="Pipeline"
        description="Who you are reaching out to, grouped by where the names came from, and where each one sits. The rules are enforced rather than displayed: a send is blocked until its consent trail and its note are complete."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Target size={20} strokeWidth={1.75} />}
          title="No prospects yet"
          description="Import the 59 Defence Industry Development Grant recipients and their 67 grants. Safe to press twice: anything already here is skipped."
          action={<ImportProspects />}
        />
      ) : (
        <>
          <CrmHealth metrics={metrics} settings={settings} dueTasks={dueTasks} />
          <PipelineView lists={lists} rows={rows} />
        </>
      )}
    </div>
  );
}
