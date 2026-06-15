import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getClientDashboardData } from "@/lib/dashboard";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const data = await getClientDashboardData(supabase, session.clientId);

  return (
    <div>
      <PageHeader
        label={["Overview"]}
        title="Dashboard"
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
