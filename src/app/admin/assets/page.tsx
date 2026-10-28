import Link from "next/link";
import { Folder } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Asset, Client } from "@/lib/types/database";
import { signAssets } from "@/lib/assets";
import { getClientFolders, buildFolderView } from "@/lib/folders";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AssetsBrowser } from "@/components/assets/AssetsBrowser";

export const metadata = { title: "Client assets" };

export default async function AdminAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; folder?: string }>;
}) {
  const session = await getPulseSession();
  const supabase = await createServerSupabase();
  const { client: clientId, folder } = await searchParams;

  const { data: clientData } = await supabase
    .from("clients")
    .select("id, business_name")
    .order("business_name");
  const clients = (clientData as Pick<Client, "id" | "business_name">[] | null) ?? [];

  // No client chosen yet — show a picker so the admin browses one tree at a time.
  if (!clientId) {
    return (
      <div>
        <PageHeader
          label={["Assets", "All Clients"]}
          title="Client files"
          description="Pick a client to browse their files. Open anything to leave feedback, organise it into folders, or upload on their behalf."
        />
        {clients.length === 0 ? (
          <EmptyState
            icon={<Folder size={20} strokeWidth={1.75} />}
            title="No clients yet"
            description="Add a client first and their files will appear here."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {clients.map((c) => (
              <Link
                key={c.id}
                href={`/admin/assets?client=${c.id}`}
                className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4 transition-colors hover:border-pulse-border-strong"
              >
                <Folder size={18} className="shrink-0 text-pulse-gold" />
                <span className="truncate text-sm text-pulse-text">
                  {c.business_name}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const folderId = folder ?? null;
  const all = await getClientFolders(supabase, clientId);
  const view = buildFolderView(all, folderId);

  let query = supabase
    .from("assets")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(300);
  query = folderId ? query.eq("folder_id", folderId) : query.is("folder_id", null);
  const { data } = await query;
  const assets = await signAssets(supabase, (data as Asset[] | null) ?? []);
  const currentClientName = clients.find((c) => c.id === clientId)?.business_name;

  return (
    <div>
      <PageHeader
        label={["Assets", currentClientName ?? "Client"]}
        title="Client files"
        description="Browse this client's files, leave feedback, organise folders, or upload on their behalf."
      />
      <AssetsBrowser
        role="admin"
        currentUserId={session?.clerkUserId ?? ""}
        clientId={clientId}
        view={view}
        assets={assets}
        currentClientName={currentClientName}
      />
    </div>
  );
}
