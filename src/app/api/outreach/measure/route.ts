import { NextResponse, type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { outreachEnabled } from "@/lib/outreach/flag";
import { measureSite, siteUrl } from "@/lib/outreach/measure";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * "Measure a site" on the Draper page (Stage 3): the same measurement the
 * morning run will ask for, run once and shown, NOT stored. A stored
 * measurement belongs to a prospect (store.ts), and that comes with the
 * connector in Stage 7. A route, not a server action: PageSpeed alone takes
 * 15 to 40 seconds.
 */
export async function POST(req: NextRequest) {
  if (!outreachEnabled()) return new NextResponse("Not found", { status: 404 });
  const session = await getPulseSession();
  if (session?.role !== "admin") return NextResponse.json({ ok: false, message: "Admins only." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const url = siteUrl(body?.url ?? "");
  if (!url) return NextResponse.json({ ok: false, message: "Give a web address, like catten.com.au." }, { status: 400 });

  const m = await measureSite(url);
  const { raw: _raw, ...shown } = m;
  return NextResponse.json({ ok: true, measurement: shown });
}
