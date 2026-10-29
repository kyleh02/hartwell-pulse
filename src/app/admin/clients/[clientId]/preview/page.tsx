import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getClientDashboardData } from "@/lib/dashboard";
import { getClientHome } from "@/lib/client-home";
import type { Client } from "@/lib/types/database";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { ClientHome } from "@/components/home/ClientHome";
import { staffNames } from "@/lib/staff";

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

  // Greeted as the first person on the account, which for most clients is the
  // only one.
  const { data: firstUser } = await supabase
    .from("client_users")
    .select("full_name")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const [home, data] = await Promise.all([
    getClientHome(supabase, clientId, {
      firstName: (firstUser as { full_name: string | null } | null)?.full_name,
      staffNames: await staffNames(),
    }),
    getClientDashboardData(supabase, clientId),
  ]);

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
        Previewing {c.business_name}. This is the Home the client sees when they
        sign in. Links and chat are switched off here.
      </div>

      {home && <ClientHome data={home} preview />}

      <h2 className="mt-10 mb-1 text-lg font-semibold tracking-tight text-pulse-text">
        Performance
      </h2>
      <p className="mb-6 text-sm text-pulse-text-dim">
        {data.currentMonthLabel
          ? `The page behind Full performance. This month (${data.currentMonthLabel}), next to last month.`
          : "The page behind Full performance, month on month."}
      </p>

      <DashboardView data={data} />
    </div>
  );
}
