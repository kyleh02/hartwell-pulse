import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { printTokenFor } from "@/lib/report-print-token";

/**
 * Render a report to PDF and attach it to the report.
 *
 * Kyle used to print the viewer himself and upload the file. That was a
 * deliberate choice for a while: the portal has no renderer, and a document
 * nobody has looked at is a bad thing to email a client. What it cost was four
 * steps on every report, and the reliable way to end up with a stale PDF was
 * to edit the report and forget the fifth.
 *
 * So the rendering is automatic and the LOOKING is not. This runs on publish,
 * puts the file on the report, and stops. Nothing sends it. The editor shows
 * what was made so it can be opened and read before Send is pressed, which
 * keeps the property that mattered without keeping the tedium.
 *
 * Deliberately NOT on the send path. Chromium is heavy, cold starts are slow
 * and a serverless timeout is a real outcome, and none of that should be able
 * to stop a client's report reaching them. A failure here leaves the previous
 * PDF alone, says so, and the manual upload still works exactly as it did.
 */

export type RenderPdfResult =
  | { ok: true; name: string }
  | { ok: false; message: string };

export async function renderReportPdf(
  supabase: SupabaseClient,
  reportId: string,
  origin: string,
): Promise<RenderPdfResult> {
  const token = printTokenFor(reportId);
  if (!token) {
    return {
      ok: false,
      message:
        "CRON_SECRET is not set, so the print page cannot be signed. Set it in Vercel, or attach the PDF by hand.",
    };
  }

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

  // The same name the viewer's tab title suggests, so a file made here and one
  // saved by hand are called the same thing.
  const safeName = `${client?.business_name ?? "Report"} - ${report.title}`
    .replace(/[^a-zA-Z0-9 ._-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const fileName = `${safeName || "report"}.pdf`;

  let pdf: Uint8Array;
  try {
    // Imported here rather than at the top so the ~50MB of Chromium is only
    // touched by the request that actually needs it.
    const { default: chromium } = await import("@sparticuz/chromium");
    const { default: puppeteer } = await import("puppeteer-core");

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 1800 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    try {
      const page = await browser.newPage();
      const url = `${origin}/print/report/${reportId}?token=${encodeURIComponent(token)}`;
      // networkidle0 rather than load: the letterhead and any screenshots are
      // signed Storage URLs fetched after first paint, and a PDF taken before
      // they land has holes in it.
      const res = await page.goto(url, {
        waitUntil: "networkidle0",
        timeout: 45_000,
      });
      if (!res || !res.ok()) {
        return {
          ok: false,
          message: `The print page returned ${res?.status() ?? "no response"}. The report may not be saved yet.`,
        };
      }
      pdf = await page.pdf({
        format: "A4",
        // The document draws its own letterhead and colours, and a PDF that
        // drops them is not the document.
        printBackground: true,
        margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
      });
    } finally {
      await browser.close();
    }
  } catch (e) {
    return {
      ok: false,
      message: `Could not render the PDF: ${e instanceof Error ? e.message : "unknown error"}. Attach one by hand and the send works the same.`,
    };
  }

  const path = `${report.client_id}/${reportId}/pdf/${Date.now()}-${fileName}`;
  const { error: upErr } = await supabase.storage
    .from("pulse-reports")
    .upload(path, Buffer.from(pdf), {
      contentType: "application/pdf",
      upsert: false,
    });
  if (upErr) return { ok: false, message: upErr.message };

  // Checked, because an unchecked write here leaves the new file in storage
  // while the report still points at the old one, and the next send goes out
  // carrying a PDF of a report that has since changed.
  const { error: updErr } = await supabase
    .from("reports")
    .update({
      pdf_path: path,
      pdf_name: fileName,
      pdf_uploaded_at: new Date().toISOString(),
    })
    .eq("id", reportId);
  if (updErr) {
    await supabase.storage.from("pulse-reports").remove([path]);
    return { ok: false, message: updErr.message };
  }

  // Only once the report points at the new one. Removing it earlier would mean
  // a failed update leaves the report pointing at a file that is gone.
  if (report.pdf_path && report.pdf_path !== path) {
    await supabase.storage.from("pulse-reports").remove([report.pdf_path]);
  }

  return { ok: true, name: fileName };
}
