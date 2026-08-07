import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getReportBundle, resolveImageUrls } from "@/lib/reports";
import { getBusinessSettings } from "@/lib/invoices";
import { sectionBlocks, type ReportBlock } from "@/lib/reports-shared";
import { ReportViewerChrome } from "@/components/reports/ReportViewerChrome";

/**
 * Deliberately the same title the client's own page uses, not "Preview". The
 * browser turns the tab title into the suggested PDF filename, and a PDF saved
 * from here is the one that gets emailed out.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const supabase = await createServerSupabase();
  const bundle = await getReportBundle(supabase, reportId);
  if (!bundle) return { title: "Report preview" };
  return { title: `${bundle.client.business_name} - ${bundle.report.title}` };
}

export default async function AdminReportPreviewPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const supabase = await createServerSupabase();
  const [bundle, business] = await Promise.all([
    getReportBundle(supabase, reportId),
    getBusinessSettings(supabase),
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
        href={`/admin/reports/${reportId}`}
        className="no-print mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ArrowLeft size={15} strokeWidth={1.75} />
        Back to editor
      </Link>

      <div className="no-print mb-6 flex items-center gap-2 rounded-[var(--radius-input)] border border-pulse-gold/30 bg-pulse-gold/10 px-4 py-2.5 text-sm text-pulse-gold">
        <Eye size={15} strokeWidth={1.75} />
        Preview — this is how {bundle.client.business_name} sees the report, and
        what Download PDF produces. It reflects the last save.
      </div>

      <ReportViewerChrome
        bundle={bundle}
        imageUrls={imageUrls}
        business={business}
      />
    </div>
  );
}
