import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { printTokenFor, type PrintKind } from "@/lib/print-token";

/**
 * Photograph one of the portal's own print pages and attach the result.
 *
 * Reports and invoices need the identical thing: launch Chromium, force the
 * light theme, open a signed print page, take an A4 PDF, put it in storage and
 * point the row at it. The only differences are which table to update and what
 * the file should be called.
 *
 * One implementation, because two copies of a headless browser launch is two
 * places for the theme seeding, the wait condition and the page size to drift
 * apart, and the first sign of that would be one document printing correctly
 * and the other not.
 */

export type RenderPdfResult =
  | { ok: true; name: string }
  | { ok: false; message: string };

/**
 * The name the client sees, and the object key, are different strings.
 *
 * They used to be the same one, and sanitising the key for storage is what
 * turned "Haús of Vitality" into "Haus of Vitality" on a document addressed to
 * her. Only the characters a filesystem genuinely refuses come out of the
 * display name; the key is folded to ASCII because nobody ever sees it and a
 * non-ASCII object key invites trouble somewhere in the chain.
 */
export function documentNames(raw: string, fallback: string) {
  const displayName =
    raw
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim() || fallback;
  const keyName =
    displayName
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || fallback.toLowerCase();
  return { fileName: `${displayName}.pdf`, keyName };
}

export async function renderAndAttach({
  supabase,
  kind,
  id,
  table,
  clientId,
  rawName,
  fallbackName,
  previousPath,
  origin,
}: {
  supabase: SupabaseClient;
  kind: PrintKind;
  id: string;
  /** The table holding pdf_path, pdf_name and pdf_uploaded_at. */
  table: "reports" | "invoices";
  clientId: string;
  /** Becomes the filename, before sanitising. */
  rawName: string;
  fallbackName: string;
  previousPath: string | null;
  origin: string;
}): Promise<RenderPdfResult> {
  const token = printTokenFor(kind, id);
  if (!token) {
    return {
      ok: false,
      message:
        "CRON_SECRET is not set, so the print page cannot be signed. Set it in Vercel, or attach the PDF by hand.",
    };
  }

  const { fileName, keyName } = documentNames(rawName, fallbackName);

  let pdf: Uint8Array;
  try {
    // Imported here rather than at the top so the ~67MB of Chromium is only
    // touched by a request that actually needs it.
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

      // The portal defaults to dark and a fresh headless profile has no theme
      // stored. Seeded before any navigation so the inline head script reads
      // light and the very first paint is right; setting it afterwards would
      // flash and would not repaint what had already been drawn.
      await page.evaluateOnNewDocument(
        (key: string, value: string) => {
          try {
            localStorage.setItem(key, value);
          } catch {
            // Storage blocked. The print page forces the light palette anyway.
          }
        },
        "pulse-theme",
        "light",
      );
      await page.emulateMediaType("print");

      const url = `${origin}/print/${kind}/${id}?token=${encodeURIComponent(token)}`;
      // networkidle0 rather than load: the letterhead and any screenshots are
      // signed Storage URLs fetched after first paint, and a PDF taken before
      // they land has holes in it.
      const res = await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
      if (!res || !res.ok()) {
        return {
          ok: false,
          message: `The print page returned ${res?.status() ?? "no response"}. It may not be saved yet.`,
        };
      }
      pdf = await page.pdf({
        format: "A4",
        // The document draws its own letterhead and colours, and a PDF that
        // drops them is not the document.
        printBackground: true,
        // globals.css already sets `@page { margin: 18mm 16mm }`, which is the
        // print design the portal was built with. Passing a second set of
        // numbers here would give the document two answers to one question.
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

  const path = `${clientId}/${id}/pdf/${Date.now()}-${keyName}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("pulse-reports")
    .upload(path, Buffer.from(pdf), {
      contentType: "application/pdf",
      upsert: false,
    });
  if (upErr) return { ok: false, message: upErr.message };

  // Checked, because an unchecked write here leaves the new file in storage
  // while the row still points at the old one, and the next send goes out
  // carrying a document that has since changed.
  const { error: updErr } = await supabase
    .from(table)
    .update({
      pdf_path: path,
      pdf_name: fileName,
      pdf_uploaded_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) {
    await supabase.storage.from("pulse-reports").remove([path]);
    return { ok: false, message: updErr.message };
  }

  // Only once the row points at the new one. Removing it earlier would mean a
  // failed update leaves the row pointing at a file that is gone.
  if (previousPath && previousPath !== path) {
    await supabase.storage.from("pulse-reports").remove([previousPath]);
  }

  return { ok: true, name: fileName };
}
