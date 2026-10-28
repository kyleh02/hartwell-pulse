import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { HARTWELL } from "@/lib/brand";
import { runSurveys } from "@/lib/nps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Weekday mornings (vercel.json): raise today's feedback round for every
 * client that is due and email it. Does nothing while surveys are off.
 */
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) return new Response(auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized", { status: auth.status });
  const origin = (process.env.NEXT_PUBLIC_APP_URL || `https://${HARTWELL.site}`).replace(/\/$/, "");
  return Response.json(await runSurveys(createAdminSupabase(), origin));
}
