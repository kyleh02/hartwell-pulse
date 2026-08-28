import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { generateWorkItems } from "@/lib/work-generate";
import { materialiseRecurrences } from "@/lib/work-recurrence";

export const dynamic = "force-dynamic";

/**
 * Fills the list from what the portal already knows.
 *
 * Safe to run as often as you like. Every insert is guarded by the partial
 * unique index on (source_kind, source_key) where state = 'open', so a second
 * run makes nothing and a duplicate is refused by the database rather than by
 * this code remembering to look.
 *
 * Hourly is the intent: an invoice that fell due at 2pm should not wait until
 * tomorrow to appear, and a send scheduled for 08:47 needs to exist by 08:00.
 */
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const generated = await generateWorkItems(supabase);
  const recurring = await materialiseRecurrences(supabase);

  return Response.json({
    generated: generated.made,
    byKind: generated.byKind,
    recurring: recurring.made,
  });
}
