import { NextResponse, type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { outreachEnabled } from "@/lib/outreach/flag";
import { sendTestNow } from "@/lib/outreach/sender";
import type { DraperSettings } from "@/lib/outreach/types";

export const runtime = "nodejs";
// A send measures its fault again first: up to 40 seconds.
export const maxDuration = 60;

/**
 * "Send now" on the Draper page, test mode only (Kyle, 21 Nov 2026). One
 * message a call; the page calls again until nothing is left. Outside test
 * mode this address doesn't exist (a 404), whoever asks.
 */
export async function POST(req: NextRequest) {
  if (!outreachEnabled()) return new NextResponse("Not found", { status: 404 });
  const session = await getPulseSession();
  if (session?.role !== "admin") return NextResponse.json({ ok: false, note: "Admins only." }, { status: 403 });
  const db = createAdminSupabase();
  const { data: s } = await db.from("outreach_settings").select("test_mode").order("version", { ascending: false }).limit(1).maybeSingle();
  if (!(s as Pick<DraperSettings, "test_mode"> | null)?.test_mode) return new NextResponse("Not found", { status: 404 });

  const body = (await req.json().catch(() => null)) as { kind?: string } | null;
  const kind = body?.kind === "follow_up" ? "follow_up" : body?.kind === "first" ? "first" : null;
  if (!kind) return NextResponse.json({ ok: false, note: "kind is first or follow_up." }, { status: 400 });
  const r = await sendTestNow(db, kind);
  return NextResponse.json({ ok: true, ...r });
}
