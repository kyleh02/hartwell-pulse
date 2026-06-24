import { redirect } from "next/navigation";
import { PenLine } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { CopyDocument } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewCopyButton } from "@/components/copy/NewCopyButton";
import { CopyDocList } from "@/components/copy/CopyDocList";

export const metadata = { title: "Copy" };

export default async function CopyPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("copy_documents")
    .select("*")
    .eq("client_id", session.clientId)
    .order("updated_at", { ascending: false });
  const docs = (data as CopyDocument[] | null) ?? [];

  return (
    <div>
      <PageHeader
        label={["Copy"]}
        title="Your copy"
        description="Draft your website and marketing copy here. It autosaves as you write, and you can submit a document to Kyle for review."
      />
      <div className="mb-5">
        <NewCopyButton
          clientId={session.clientId}
          basePath="/copy"
          currentUserId={session.clerkUserId}
        />
      </div>
      {docs.length === 0 ? (
        <EmptyState
          icon={<PenLine size={20} strokeWidth={1.75} />}
          title="No documents yet"
          description="Start a new document to draft your copy. Everything autosaves as you type."
        />
      ) : (
        <CopyDocList docs={docs} basePath="/copy" />
      )}
    </div>
  );
}
