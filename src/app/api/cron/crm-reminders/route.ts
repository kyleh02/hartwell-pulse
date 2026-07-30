import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Daily. Turns due CRM tasks into notifications for Kyle, which ride the
// existing bell, email and web push pipeline. Also books a re-verify task when
// a prospect's evidence has gone stale, since a fault cited in an email that
// has since been fixed destroys credibility.
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
  if (admins.length === 0) return Response.json({ reminders: 0, reverify: 0 });

  const { data: dueData } = await supabase
    .from("crm_tasks")
    .select("id, title, due_on, organisation_id, crm_organisations(legal_name)")
    .is("done_at", null)
    .is("notified_at", null)
    .lte("due_on", today)
    .order("due_on")
    .limit(50);
  const due =
    (dueData as
      | {
          id: string;
          title: string;
          due_on: string;
          organisation_id: string | null;
          crm_organisations: { legal_name: string } | null;
        }[]
      | null) ?? [];

  let reminders = 0;
  for (const task of due) {
    const company = task.crm_organisations?.legal_name ?? "Ironpeak outreach";
    for (const recipient of admins) {
      await supabase.from("notifications").insert({
        recipient_user_id: recipient,
        client_id: null,
        type: "crm_reminder",
        title: `Due today: ${company}`,
        body: task.title,
        link: task.organisation_id ? `/admin/crm/${task.organisation_id}` : "/admin/crm",
        channel: "instant",
      });
    }
    // Stamped so a task nags once, not every morning until it is done. The
    // portal still lists it under Due now for as long as it is open.
    await supabase
      .from("crm_tasks")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", task.id);
    reminders++;
  }

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

  return Response.json({ reminders, reverify });
}
