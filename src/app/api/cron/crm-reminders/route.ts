import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Daily. Books a re-verify task when a prospect's evidence has gone stale,
// since a fault cited in an email that has since been fixed destroys
// credibility.
//
// It used to also turn every due CRM task into a notification. That is gone.
// Those tasks become work items now, on the dashboard, where they have a Done
// button and a Snooze and a Not doing. A notification could only be read, and
// reading one changed nothing, so it came back the next morning and the one
// after that. This is the cron that was driving Kyle mad.
export async function GET(req: NextRequest) {
  const auth = cronAuthorized(req);
  if (!auth.ok) {
    return new Response(
      auth.status === 503 ? "Cron not configured (set CRON_SECRET)" : "Unauthorized",
      { status: auth.status },
    );
  }

  const supabase = createAdminSupabase();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Admins are the only recipients: the CRM is Kyle's, and no client_id is set.
  const { data: adminData } = await supabase
    .from("client_users")
    .select("clerk_user_id")
    .eq("role", "admin");
  const admins = ((adminData as { clerk_user_id: string }[] | null) ?? []).map(
    (a) => a.clerk_user_id,
  );
  if (admins.length === 0) return Response.json({ reverify: 0 });

  // The task-to-notification loop lived here. Work items replaced it: see
  // src/lib/work-generate.ts, fromCrmTasks. Nothing is lost, because the
  // dashboard shows the same tasks with buttons on them instead of a bell that
  // could only be dismissed.

  // Evidence older than the re-verify window, on companies still in play.
  const { data: settingsData } = await supabase
    .from("crm_settings")
    .select("reverify_after_days")
    .maybeSingle();
  const staleDays =
    (settingsData as { reverify_after_days: number } | null)?.reverify_after_days ?? 14;
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();

  const { data: staleData } = await supabase
    .from("crm_organisations")
    .select("id, legal_name")
    .in("stage", ["verified", "contacted", "connected", "followed_up"])
    .lt("last_verified_at", cutoff)
    .limit(25);
  const stale = (staleData as { id: string; legal_name: string }[] | null) ?? [];

  let reverify = 0;
  for (const org of stale) {
    const { count } = await supabase
      .from("crm_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", org.id)
      .eq("kind", "reverify")
      .is("done_at", null);
    if ((count ?? 0) > 0) continue;
    await supabase.from("crm_tasks").insert({
      organisation_id: org.id,
      kind: "reverify",
      title: `Re-check the findings for ${org.legal_name} before writing again`,
      due_on: today,
    });
    reverify++;
  }

  return Response.json({ reverify });
}
