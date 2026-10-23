import { notFound, redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { DriveBrowser } from "@/components/drive/DriveBrowser";

export const metadata = { title: "Shared files" };

/**
 * A Drive folder Kyle has shared with this client. This is the page the
 * emailed and copied links open; anyone signed out goes through sign-in and
 * lands back here.
 */
export default async function ClientDriveFolderPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");
  const { linkId } = await params;

  // RLS returns only this client's own links.
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("drive_links")
    .select("id, title, client_id")
    .eq("id", linkId)
    .maybeSingle();
  const link = data as { id: string; title: string; client_id: string } | null;
  if (!link || link.client_id !== session.clientId) notFound();

  return (
    <div>
      <PageHeader
        label={["Assets", link.title]}
        title={link.title}
        description="Files shared with you by Kyle. Open anything to preview it, download what you need, or drop files anywhere on this page to send them over."
      />
      <DriveBrowser
        linkId={link.id}
        title={link.title}
        role="client"
        backHref="/assets"
        backLabel="Assets"
      />
    </div>
  );
}
