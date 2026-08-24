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

  // What the client sees on the attachment. Her business name as she spells it,
  // accent and all, then the report title, spaces between the words.
  //
  // Two names rather than one, and that is the fix for the accent going
  // missing: the storage key used to be this string, so making the key safe
  // made the filename wrong. Only the characters a filesystem genuinely
  // refuses come out, and no hyphens are put in. "Haus-of-Vitality-Month-One-
  // Report.pdf" reads like a slug in a downloads folder; this reads like a
  // document.
  const displayName =
    `${client?.business_name ?? "Report"} ${report.title}`
      // Illegal in a Windows or macOS filename. Everything else, including
      // accented letters, is left exactly as written.
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Report";
  const fileName = `${displayName}.pdf`;

  // The storage key is a different problem with a different answer. It is
  // never shown to anyone, and a non-ASCII object key is asking for trouble
  // from something in the chain, so this one is folded down hard.
  const keyName =
    displayName
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "report";

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

      // The portal defaults to DARK, and a fresh headless profile has no theme
      // stored, so the first PDF came out as a light document sitting on a
      // black page. Seeded before any navigation, so the inline head script
      // reads light and the very first paint is right; setting it afterwards
      // would flash and, worse, would not change what was already painted.
      await page.evaluateOnNewDocument(
        (key: string, value: string) => {
          try {
            localStorage.setItem(key, value);
          } catch {
            // Storage blocked. Print media still forces the light tokens.
          }
        },
        "pulse-theme",
        "light",
      );
      // Belt and braces on the same problem. page.pdf() emulates print media
      // on its own, but saying so means the @media print block is certainly
      // the one that applied, whatever a future version decides to default to.
      await page.emulateMediaType("print");

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
        // No margin here on purpose. globals.css already sets `@page { margin:
        // 18mm 16mm }`, which is the print design the portal was built with,
        // and passing a second set of numbers here just gives the document two
        // answers to the same question.
        preferCSSPageSize: true,
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

  const path = `${report.client_id}/${reportId}/pdf/${Date.now()}-${keyName}.pdf`;
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
