import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getClientDashboardData } from "@/lib/dashboard";
import type { Client } from "@/lib/types/database";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const metadata = { title: "Client preview" };

export default async function ClientPreviewPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const supabase = await createServerSupabase();
  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) notFound();
  const c = client as Client;

  const data = await getClientDashboardData(supabase, clientId);

  return (
    <div>
      <Link
        href="/admin/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ArrowLeft size={15} strokeWidth={1.75} />
        Back to clients
      </Link>

      <div className="mb-6 flex items-center gap-2 rounded-[var(--radius-input)] border border-pulse-gold/30 bg-pulse-gold/10 px-4 py-2.5 text-sm text-pulse-gold">
        <Eye size={15} strokeWidth={1.75} />
        Previewing {c.business_name} — this is the dashboard the client sees.
      </div>

      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-pulse-text">
        {c.business_name}
      </h1>
      <p className="mb-6 text-sm text-pulse-text-dim">
        {data.currentMonthLabel
          ? `This month (${data.currentMonthLabel}), next to last month.`
          : "Month on month."}
      </p>

      <DashboardView data={data} />
    </div>
  );
}
