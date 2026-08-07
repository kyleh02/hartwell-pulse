import { notFound, redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getReportBundle, resolveImageUrls } from "@/lib/reports";
import { getBusinessSettings } from "@/lib/invoices";
import { sectionBlocks, type ReportBlock } from "@/lib/reports-shared";
import { ReportViewerChrome } from "@/components/reports/ReportViewerChrome";

/**
 * The tab title is also the filename the browser suggests when this is saved
 * as a PDF, so it is the report and the client rather than the word "Report".
 * A client should not have to rename the file before filing it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const supabase = await createServerSupabase();
  const bundle = await getReportBundle(supabase, reportId);
  if (!bundle) return { title: "Report" };
  return { title: `${bundle.client.business_name} - ${bundle.report.title}` };
}

export default async function ReportViewerPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const [bundle, business] = await Promise.all([
    getReportBundle(supabase, reportId),
    // business_settings is admin-only under RLS, but the letterhead on a
    // report is meant for the client to read. Service role, and only the
    // letterhead fields are rendered (this is a server component).
    getBusinessSettings(createAdminSupabase()),
  ]);

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

  // No page title here on purpose: the report's own letterhead carries the
  // title, the month and who it is for, and it is the same block that prints.
  return (
    <ReportViewerChrome
      bundle={bundle}
      imageUrls={imageUrls}
      business={business}
    />
  );
}
