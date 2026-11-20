import { type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { outreachEnabled } from "@/lib/outreach/flag";
import { tick } from "@/lib/outreach/sender";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Draper's tick (Stage 5), called by cron-job.org every five minutes with
 * CRON_SECRET (Vercel Hobby runs its own crons once a day at most). Each call
 * does one thing: fix the 8am queue, send one email, or confirm one draft.
 * See src/lib/outreach/sender.ts.
 */
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized", { status: auth.status });
  }
  if (!outreachEnabled()) return new Response("Draper is off (OUTREACH_ENABLED)", { status: 200 });
  try {
    const note = await tick(createAdminSupabase());
    return Response.json({ ok: true, note });
  } catch (e) {
    console.error("[outreach-tick]", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
