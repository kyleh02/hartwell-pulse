import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getClientDashboardData } from "@/lib/dashboard";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const metadata = { title: "Performance" };

export default async function PerformancePage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const data = await getClientDashboardData(supabase, session.clientId);

  return (
    <div>
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ArrowLeft size={15} strokeWidth={1.75} />
        Home
      </Link>
      <PageHeader
        label={["Home", "Performance"]}
        title="Performance"
        description={
          data.currentMonthLabel
            ? `How your marketing is going this month (${data.currentMonthLabel}), next to last month.`
            : "How your marketing is going, month on month."
        }
      />
      <DashboardView data={data} />
    </div>
  );
}
