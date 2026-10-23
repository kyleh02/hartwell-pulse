import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { DriveBrowser } from "@/components/drive/DriveBrowser";

export const metadata = { title: "Shared Drive folder" };

/** A client's shared Drive folder, exactly as they see it, for Kyle. */
export default async function AdminDriveFolderPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const { linkId } = await params;
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("drive_links")
    .select("id, title, client_id, clients(business_name)")
    .eq("id", linkId)
    .maybeSingle();
  const link = data as {
    id: string;
    title: string;
    client_id: string;
    clients: { business_name: string } | { business_name: string }[] | null;
  } | null;
  if (!link) notFound();
  const client = Array.isArray(link.clients) ? link.clients[0] : link.clients;
  const clientName = client?.business_name ?? "Client";

  return (
    <div>
      <PageHeader
        label={["Assets", clientName, link.title]}
        title={link.title}
        description={`What ${clientName} sees. Files you add to this folder in Drive appear here as soon as they're saved.`}
      />
      <DriveBrowser
        linkId={link.id}
        title={link.title}
        role="admin"
        backHref={`/admin/assets?client=${link.client_id}`}
        backLabel={clientName}
      />
    </div>
  );
}
