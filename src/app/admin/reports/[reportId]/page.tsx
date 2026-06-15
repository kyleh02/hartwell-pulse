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

  return (
    <div>
      <Link
        href="/admin/reports"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ArrowLeft size={15} strokeWidth={1.75} />
        All reports
      </Link>
      <ReportEditor bundle={bundle} imageUrls={imageUrls} snippets={snippets} />
    </div>
  );
}
