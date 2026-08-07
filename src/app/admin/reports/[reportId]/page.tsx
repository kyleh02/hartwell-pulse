import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getReportBundle, listSnippets, resolveImageUrls } from "@/lib/reports";
import { sectionBlocks, type ReportBlock } from "@/lib/reports-shared";
import { ReportEditor } from "@/components/reports/ReportEditor";

export const metadata = { title: "Edit report" };

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const supabase = await createServerSupabase();

  const [bundle, snippets] = await Promise.all([
    getReportBundle(supabase, reportId),
    listSnippets(supabase),
  ]);
  if (!bundle) notFound();

  const imagePaths = bundle.sections
    .flatMap((s) => sectionBlocks(s))
    .filter((b): b is Extract<ReportBlock, { type: "image" }> => b.type === "image")
    .map((b) => b.path);
  const imageUrls = await resolveImageUrls(supabase, imagePaths);

  // Everyone on the client's account, so the report can be pointed at some of
  // them. Ordered by name so the list does not reshuffle between visits.
  const { data: peopleRows } = await supabase
    .from("client_users")
    .select("clerk_user_id, full_name, email")
    .eq("client_id", bundle.report.client_id)
    .eq("role", "client")
    .order("full_name");
  const people =
    (peopleRows as
      | { clerk_user_id: string; full_name: string | null; email: string | null }[]
      | null) ?? [];

  return (
    <div>
      <Link
        href="/admin/reports"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ArrowLeft size={15} strokeWidth={1.75} />
        All reports
      </Link>
      <ReportEditor
        bundle={bundle}
        imageUrls={imageUrls}
        snippets={snippets}
        people={people}
      />
    </div>
  );
}
