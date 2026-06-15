import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { listClientReports } from "@/lib/reports";
import { monthLabel } from "@/lib/metrics";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const reports = await listClientReports(supabase, session.clientId);

  return (
    <div>
      <PageHeader
        label={["Reports"]}
        title="Your monthly reports"
        description="Every month Kyle puts together a report on how your marketing is going. They show up here, newest first."
      />

      {reports.length === 0 ? (
        <EmptyState
          icon={<FileText size={20} strokeWidth={1.75} />}
          title="No reports yet"
          description="Your first report will appear here once it is published. You will get a heads up when it is ready."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => (
            <Link key={r.id} href={`/reports/${r.id}`}>
              <Card className="p-5 transition-colors hover:border-pulse-border-strong">
                <p className="mono-label">{monthLabel(r.period_month)}</p>
                <h3 className="mt-2 text-base font-medium text-pulse-text">
                  {r.title}
                </h3>
                <p className="data-mono mt-2 text-xs text-pulse-text-mute">
                  Read report →
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
