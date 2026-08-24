import { notFound } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getReportBundle, resolveImageUrls } from "@/lib/reports";
import { getBusinessSettings } from "@/lib/invoices";
import { sectionBlocks, type ReportBlock } from "@/lib/reports-shared";
import { ReportViewerChrome } from "@/components/reports/ReportViewerChrome";
import { printTokenValid } from "@/lib/report-print-token";

/**
 * The page the PDF renderer opens. Not for people.
 *
 * A headless browser has no Clerk session and cannot be given one, so it
 * cannot open the client's viewer. This is the same document, reachable
 * without a login, and guarded by a signed token scoped to one report id and
 * good for five minutes.
 *
 * It renders the identical component the client sees, on purpose. Building a
 * separate print-only view would mean two documents to keep in step, and the
 * PDF would drift from the portal the first time only one of them was changed.
 * The chrome around it already carries `no-print`, so the print stylesheet
 * takes the navigation and the search box out on its own.
 *
 * Service-role Supabase, because there is no session to scope RLS with. The
 * token IS the access check here, which is why it is signed and short-lived
 * rather than a guessable id.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const supabase = createAdminSupabase();
  const bundle = await getReportBundle(supabase, reportId);
  // The same title the viewer uses. It is what a browser suggests as the
  // filename, and it is worth the two staying identical.
  return {
    title: bundle
      ? `${bundle.client.business_name} - ${bundle.report.title}`
      : "Report",
  };
}

export default async function ReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { reportId } = await params;
  const { token } = await searchParams;

  // notFound rather than a message: an unsigned request should not learn
  // whether the id it guessed exists.
  if (!printTokenValid(reportId, token)) notFound();

  const supabase = createAdminSupabase();
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
    <div data-report-print-ready="1">
      {/*
        The light palette, forced, in every medium.

        This page kept coming out as a light document on a black page. The
        portal defaults to dark, and the two indirect fixes for that both
        failed quietly: seeding the theme into localStorage depends on the head
        script running the way it does today, and the @media print block
        depends on the renderer emulating print media and on that rule winning
        the cascade against a Tailwind utility on <body>.

        Neither dependency is worth having on a page whose entire job is to be
        photographed. This is the same set of values the print block uses, set
        here with no media query and no layer, last in document order, on a
        route nothing else shares. It cannot lose.
      */}
      <style>{`
        :root, :root[data-theme="dark"], :root[data-theme="light"] {
          --pulse-bg: #ffffff;
          --pulse-surface: #ffffff;
          --pulse-surface-2: #f6f5f1;
          --pulse-border: rgba(0, 0, 0, 0.12);
          --pulse-border-strong: rgba(0, 0, 0, 0.2);
          --pulse-gold: #8a7645;
          --pulse-text: #1a1714;
          --pulse-text-dim: rgba(26, 23, 20, 0.72);
          --pulse-text-mute: rgba(26, 23, 20, 0.5);
        }
        html, body {
          background: #ffffff !important;
          color: #1a1714 !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      `}</style>
      <ReportViewerChrome
        bundle={bundle}
        imageUrls={imageUrls}
        business={business}
      />
    </div>
  );
}
