import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  DriveError,
  fetchExport,
  fetchMedia,
  fetchThumbnail,
  readRawToken,
} from "@/lib/google-drive";
import { EXPORTS, browserCanShow, exportFilename, kindOf } from "@/lib/drive-shared";

export const runtime = "nodejs";
// Streaming a large file or a long video can run a while.
export const maxDuration = 60;

/**
 * The bytes of one Drive file, for a thumbnail, a preview or a download.
 *
 * Public in middleware, like the print routes, because the browser fetches
 * these itself (an <img>, a <video>, a PDF frame) and a Clerk session is not
 * reliably fresh by then. What stands in for the session is the token: signed
 * by this server while listing a folder it had just checked, scoped to one
 * file and one linked folder, and dead within the hour. The link is looked up
 * again here, so unlinking a folder stops its files at once.
 *
 * Everything served is from someone else's upload, on the portal's own origin,
 * so nothing is ever allowed to run: nosniff everywhere, a sandbox policy on
 * anything shown inline, and anything that is not an image, video, audio or
 * PDF goes out as a download only. An HTML file opened inline here would be
 * script running as the portal.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; name: string }> },
) {
  const { token } = await params;
  const claim = readRawToken(token);
  if (!claim) return new NextResponse("This link has expired. Refresh the page.", { status: 410 });

  const { data: link } = await createAdminSupabase()
    .from("drive_links")
    .select("id")
    .eq("id", claim.l)
    .maybeSingle();
  if (!link) return new NextResponse("Not found", { status: 404 });

  const mode = req.nextUrl.searchParams.get("m") ?? "view";
  const kind = kindOf(claim.m);

  try {
    if (mode === "thumb") {
      const size = Math.min(1600, Math.max(120, Number(req.nextUrl.searchParams.get("s")) || 400));
      const res = await fetchThumbnail(claim.f, size);
      if (!res) return new NextResponse(null, { status: 404 });
      return stream(res, {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        // Same token for a half hour, so a return visit is instant.
        "Cache-Control": "private, max-age=3600",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      });
    }

    const exports = EXPORTS[kind];
    if (exports) {
      // A Google Doc has no bytes of its own: preview as PDF, download as asked.
      const as = mode === "dl" ? req.nextUrl.searchParams.get("as") ?? "pdf" : "pdf";
      const fmt = exports.find((x) => x.as === as) ?? exports[0];
      const res = await fetchExport(claim.f, fmt.mime);
      return stream(res, {
        "Content-Type": fmt.mime,
        "Content-Disposition": disposition(mode === "dl" ? "attachment" : "inline", exportFilename(claim.n, fmt.ext)),
        "Cache-Control": "private, no-store",
      });
    }
    if (kind === "google" || kind === "folder") {
      return new NextResponse("This kind of file can only be opened in Google Drive.", { status: 415 });
    }

    // Only what a browser shows without running anything is served inline.
    const inlineOk =
      mode !== "dl" &&
      (browserCanShow(claim.m) || kind === "pdf" || kind === "video" || kind === "audio");
    const res = await fetchMedia(claim.f, req.headers.get("range"));
    const headers: Record<string, string> = {
      "Content-Type": inlineOk ? claim.m : "application/octet-stream",
      "Content-Disposition": disposition(inlineOk ? "inline" : "attachment", claim.n),
      "Cache-Control": "private, max-age=600",
      "Accept-Ranges": "bytes",
    };
    // Chrome will not draw a PDF inside a sandboxed document, and its viewer
    // is isolated anyway; everything else shown inline gets the sandbox.
    if (inlineOk && kind !== "pdf") {
      headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
    }
    for (const h of ["content-length", "content-range"]) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    return stream(res, headers, res.status === 206 ? 206 : 200);
  } catch (e) {
    if (e instanceof DriveError) {
      const status =
        e.code === "not_found" ? 404 : e.code === "too_large" ? 413 : e.code === "forbidden" ? 403 : 502;
      return new NextResponse(e.message, { status });
    }
    throw e;
  }
}

function stream(res: Response, headers: Record<string, string>, status = 200) {
  return new NextResponse(res.body, {
    status,
    headers: { ...headers, "X-Content-Type-Options": "nosniff" },
  });
}

/** A filename that survives any characters, per RFC 6266. */
function disposition(type: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
