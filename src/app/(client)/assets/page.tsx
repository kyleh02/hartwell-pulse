import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Asset } from "@/lib/types/database";
import { signAssets } from "@/lib/assets";
import { getClientFolders, buildFolderView } from "@/lib/folders";
import { PageHeader } from "@/components/ui/PageHeader";
import { AssetsBrowser } from "@/components/assets/AssetsBrowser";

export const metadata = { title: "Assets" };

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const { folder } = await searchParams;
  const folderId = folder ?? null;

  const supabase = await createServerSupabase();
  const all = await getClientFolders(supabase, session.clientId);
  const view = buildFolderView(all, folderId);

  let query = supabase
    .from("assets")
    .select("*")
    .eq("client_id", session.clientId)
    .order("created_at", { ascending: false })
    .limit(300);
  query = folderId ? query.eq("folder_id", folderId) : query.is("folder_id", null);
  const { data } = await query;
  const assets = await signAssets(supabase, (data as Asset[] | null) ?? []);

  return (
    <div>
      <PageHeader
        label={["Assets"]}
        title="Your files"
        description="Keep your images, documents and copy in one place. Sort them into folders, tag them, and Kyle can leave notes right on anything you upload."
      />
      <AssetsBrowser
        role="client"
        currentUserId={session.clerkUserId}
        clientId={session.clientId}
        view={view}
        assets={assets}
      />
    </div>
  );
}
