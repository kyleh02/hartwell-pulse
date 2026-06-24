import { notFound } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { CopyDocument, CopyDocumentVersion } from "@/lib/types/database";
import { CopyEditor } from "@/components/copy/CopyEditor";

export const metadata = { title: "Review copy" };

export default async function AdminCopyDocPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const session = await getPulseSession();
  const { docId } = await params;
  const supabase = await createServerSupabase();

  const { data: docRow } = await supabase
    .from("copy_documents")
    .select("*")
    .eq("id", docId)
    .maybeSingle();
  const doc = docRow as CopyDocument | null;
  if (!doc) notFound();

  const { data: vers } = await supabase
    .from("copy_document_versions")
    .select("*")
    .eq("document_id", docId)
    .order("created_at", { ascending: false })
    .limit(50);
  const versions = (vers as CopyDocumentVersion[] | null) ?? [];

  return (
    <CopyEditor
      doc={doc}
      versions={versions}
      role="admin"
      currentUserId={session?.clerkUserId ?? ""}
      backHref={`/admin/copy?client=${doc.client_id}`}
    />
  );
}
