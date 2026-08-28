import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderAndAttach, type RenderPdfResult } from "@/lib/pdf-render";

export type { RenderPdfResult };

/**
 * Render a report to PDF and attach it to the report.
 *
 * Kyle used to print the viewer himself and upload the file. That was a
 * deliberate choice for a while: the portal had no renderer, and a document
 * nobody has looked at is a bad thing to email a client. What it cost was four
 * steps on every report, and the reliable way to end up with a stale PDF was
 * to edit the report and forget the fifth.
 *
 * So the rendering is automatic and the LOOKING is not. This runs on publish,
 * puts the file on the report, and stops. Nothing sends it. The editor shows
 * what was made so it can be opened and read before Send is pressed, which
 * keeps the property that mattered without keeping the tedium.
 *
 * Deliberately NOT on the send path, unlike the invoice version. A report can
 * always wait; Chromium is heavy, cold starts are slow, and a failure here
 * leaves the previous PDF alone and the manual upload working exactly as it
 * did. An invoice has no publish step and can be sent by a cron, so it makes
 * the opposite trade. See report-pdf's sibling for that reasoning.
 */
export async function renderReportPdf(
  supabase: SupabaseClient,
  reportId: string,
  origin: string,
): Promise<RenderPdfResult> {
  const { data: row } = await supabase
    .from("reports")
    .select("client_id, title, pdf_path, clients(business_name)")
    .eq("id", reportId)
    .maybeSingle();
  if (!row) return { ok: false, message: "That report no longer exists." };
  const report = row as {
    client_id: string;
    title: string;
    pdf_path: string | null;
    clients: { business_name: string } | { business_name: string }[] | null;
  };
  const client = Array.isArray(report.clients) ? report.clients[0] : report.clients;

  return renderAndAttach({
    supabase,
    kind: "report",
    id: reportId,
    table: "reports",
    clientId: report.client_id,
    // Her business name as she spells it, then the report title.
    rawName: `${client?.business_name ?? "Report"} ${report.title}`,
    fallbackName: "Report",
    previousPath: report.pdf_path,
    origin,
  });
}
