import { type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { renderReportPdf } from "@/lib/report-pdf";

/**
 * Make the PDF for one report and attach it.
 *
 * A route handler rather than a server action, for one reason: Chromium is
 * slow to start and `maxDuration` can only be set on a route or a page. A
 * server action inherits whatever the calling page allows, which on Hobby is
 * ten seconds, and a cold render does not finish in ten seconds.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const session = await getPulseSession();
  if (session?.role !== "admin") {
    return Response.json({ ok: false, message: "Not authorised" }, { status: 403 });
  }

  const { reportId } = await params;

  // The renderer opens a real URL over the network, so it needs the address
  // this deployment answers on. The configured one first, since that is the
  // canonical host; the request's own origin as a fallback for a preview
  // deployment, where the two differ.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || req.nextUrl.origin;

  // Service role deliberately: the render writes the report row and the
  // storage object, and it has already passed the admin check above.
  const result = await renderReportPdf(createAdminSupabase(), reportId, origin);

  // 200 either way. The failure is an outcome the editor shows rather than an
  // exception, because the whole point is that a render that does not work
  // leaves the previous PDF alone and the manual upload still available.
  return Response.json(result);
}
