import { notFound, redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getReportBundle, resolveImageUrls } from "@/lib/reports";
import { sectionBlocks, type ReportBlock } from "@/lib/reports-shared";
import { monthLabel } from "@/lib/metrics";
import { ReportViewerChrome } from "@/components/reports/ReportViewerChrome";

export const metadata = { title: "Report" };

export default async function ReportViewerPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const bundle = await getReportBundle(supabase, reportId);

  // RLS already restricts a client to their own published reports; this is a
  // belt-and-braces check so a draft or someone else's report 404s cleanly.
  if (
    !bundle ||
    bundle.report.client_id !== session.clientId ||
    bundle.report.status !== "published"
  ) {
    notFound();
  }

  const imagePaths = bundle.sections
    .flatMap((s) => sectionBlocks(s))
    .filter((b): b is Extract<ReportBlock, { type: "image" }> => b.type === "image")
    .map((b) => b.path);
  const imageUrls = await resolveImageUrls(supabase, imagePaths);

  return (
    <div>
      <div className="no-print mb-6">
        <p className="mono-label">{monthLabel(bundle.report.period_month)}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-pulse-text">
          {bundle.report.title}
        </h1>
      </div>
      <ReportViewerChrome bundle={bundle} imageUrls={imageUrls} />
    </div>
  );
}
