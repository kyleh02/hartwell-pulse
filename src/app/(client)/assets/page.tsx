import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Asset } from "@/lib/types/database";
import { signAssets } from "@/lib/assets";
import { PageHeader } from "@/components/ui/PageHeader";
import { AssetsView } from "@/components/assets/AssetsView";

export const metadata = { title: "Assets" };

export default async function AssetsPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("assets")
    .select("*")
    .eq("client_id", session.clientId)
    .order("created_at", { ascending: false });

  const assets = await signAssets(supabase, (data as Asset[] | null) ?? []);

  return (
    <div>
      <PageHeader
        label={["Assets"]}
        title="Your assets"
        description="Drop your images and copy here so they are all in one place. Sort them into folders, tag them, and Kyle can leave notes right on anything you upload."
      />
      <AssetsView
        role="client"
        currentUserId={session.clerkUserId}
        assets={assets}
        selfClientId={session.clientId}
      />
    </div>
  );
}
