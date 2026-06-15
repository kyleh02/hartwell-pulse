import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Asset, Client } from "@/lib/types/database";
import { signAssets } from "@/lib/assets";
import { PageHeader } from "@/components/ui/PageHeader";
import { AssetsView } from "@/components/assets/AssetsView";

export const metadata = { title: "Client assets" };

export default async function AdminAssetsPage() {
  const session = await getPulseSession();
  const supabase = await createServerSupabase();

  const [{ data: assetData }, { data: clientData }] = await Promise.all([
    supabase.from("assets").select("*").order("created_at", { ascending: false }),
    supabase.from("clients").select("id, business_name").order("business_name"),
  ]);

  const clients = (clientData as Pick<Client, "id" | "business_name">[] | null) ?? [];
  const names = new Map(clients.map((c) => [c.id, c.business_name]));
  const assets = await signAssets(supabase, (assetData as Asset[] | null) ?? [], names);

  return (
    <div>
      <PageHeader
        label={["Assets", "All Clients"]}
        title="Client assets"
        description="Everything every client has uploaded, in one place. Browse by client or folder, open anything to leave feedback, or upload on a client's behalf."
      />
      <AssetsView
        role="admin"
        currentUserId={session?.clerkUserId ?? ""}
        assets={assets}
        clients={clients}
      />
    </div>
  );
}
