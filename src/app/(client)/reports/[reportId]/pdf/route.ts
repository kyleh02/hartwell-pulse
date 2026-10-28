import { NextResponse, type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * The report's PDF, for the client it belongs to.
 *
 * The report is read as the client first, so RLS decides whether they may
 * have it at all (their own, published). Only then is a one-minute signed URL
 * minted for the file and the browser sent to it, so no lasting link to the
 * file ever sits in a page or an email.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const session = await getPulseSession();
  if (!session?.clientId) return NextResponse.redirect(new URL("/", req.url));
  const { reportId } = await params;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("reports")
    .select("id, client_id, status, pdf_path, pdf_name, title")
    .eq("id", reportId)
    .eq("status", "published")
    .maybeSingle();
  const report = data as {
    client_id: string;
    pdf_path: string | null;
    pdf_name: string | null;
    title: string;
  } | null;
  if (!report || report.client_id !== session.clientId) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!report.pdf_path) {
    // No file yet: the report page itself prints to PDF.
    return NextResponse.redirect(new URL(`/reports/${reportId}`, req.url));
  }

  const { data: signed, error } = await createAdminSupabase()
    .storage.from("pulse-reports")
    .createSignedUrl(report.pdf_path, 60, {
      download: report.pdf_name || `${report.title}.pdf`,
    });
  if (error || !signed?.signedUrl) {
    return new NextResponse("The PDF could not be opened. Try again in a moment.", { status: 502 });
  }
  return NextResponse.redirect(signed.signedUrl);
}
