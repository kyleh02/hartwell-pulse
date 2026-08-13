import { redirect } from "next/navigation";
import { Globe } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SitePreview, type PreviewItem } from "@/components/preview/SitePreview";

export const metadata = { title: "Your website" };

export default async function WebsitePreviewPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  // RLS returns only this client's rows, and only the visible ones, so a page
  // Kyle is still working on cannot appear here by accident.
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("client_previews")
    .select("id, title, url, note")
    .order("position");
  const items = (data as PreviewItem[] | null) ?? [];

  return (
    <div>
      <PageHeader
        label={["Website"]}
        title="Your website"
        description="The site as it stands right now. It updates as work goes on, so what you see here is always the latest version rather than a screenshot from last week."
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Globe size={20} strokeWidth={1.75} />}
          title="Nothing to preview yet"
          description="Once there is something to look at, it will appear here and Kyle will let you know in Messages."
        />
      ) : (
        <SitePreview items={items} />
      )}
    </div>
  );
}
