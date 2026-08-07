import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { listAdminReports } from "@/lib/reports";
import { monthLabel } from "@/lib/metrics";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { ImportReport } from "@/components/reports/ImportReport";
import { IronpeakMark } from "@/components/brand/IronpeakMark";

export const metadata = { title: "Reports" };

export default async function AdminReportsPage() {
  const supabase = await createServerSupabase();
  const [reports, { data: clientRows }] = await Promise.all([
    listAdminReports(supabase),
    supabase
      .from("clients")
      .select("id, business_name, deleted_at, purged_at")
      .order("business_name"),
  ]);
  const clients = (
    (clientRows as
      | { id: string; business_name: string; deleted_at: string | null; purged_at: string | null }[]
      | null) ?? []
  )
    .filter((c) => !c.deleted_at && !c.purged_at)
    .map((c) => ({ id: c.id, business_name: c.business_name }));

  return (
    <div>
      <PageHeader
        label={["Reports", "Builder"]}
        title="Reports"
        description="Build a monthly report from a client's metrics, add your insights and recommendations, and publish it to their portal."
        actions={
          <>
            <ImportReport clients={clients} />
            <Link href="/admin/reports/new" className={buttonClasses("primary", "md")}>
              <Plus size={16} strokeWidth={2} /> New report
            </Link>
          </>
        }
      />

      {reports.length === 0 ? (
        <EmptyState
          icon={<FileText size={20} strokeWidth={1.75} />}
          title="No reports yet"
          description="Start one with New report. It pulls the client's metrics into a draft you can shape and publish."
        />
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <Link key={r.id} href={`/admin/reports/${r.id}`}>
              <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-pulse-border-strong">
                <div className="min-w-0">
                  <p className="font-medium text-pulse-text">{r.client_name}</p>
                  <p className="data-mono mt-0.5 truncate text-xs text-pulse-text-mute">
                    {monthLabel(r.period_month)} · {r.title}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Only worth showing when it is NOT the house brand. A badge
                      on every row would just be noise. */}
                  {r.brand === "ironpeak" && (
                    <span className="hidden items-center gap-1.5 rounded-full border border-pulse-border px-2.5 py-1 text-[11px] text-pulse-text-dim sm:inline-flex">
                      <IronpeakMark size={11} />
                      Ironpeak
                    </span>
                  )}
                  <Badge tone={r.status === "published" ? "success" : "neutral"}>
                    {r.status}
                  </Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
