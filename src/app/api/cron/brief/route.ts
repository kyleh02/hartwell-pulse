import { type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { generateWorkItems } from "@/lib/work-generate";
import { materialiseRecurrences } from "@/lib/work-recurrence";
import { listWork } from "@/lib/work";
import { bucketFor, daysOverdue, isSnoozed } from "@/lib/work-shared";

export const dynamic = "force-dynamic";

/**
 * The morning brief. One notification a day, and the only one Kyle's own work
 * is allowed to send.
 *
 * What it replaces: a notification per due CRM task, every morning, with no
 * way to answer any of them. Nine nags became one line that links to a list
 * where everything has a button.
 *
 * It generates first, so the brief describes today rather than yesterday. If
 * the hourly cron has already run, generating again makes nothing: the unique
 * index sees to that.
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
  await generateWorkItems(supabase);
  await materialiseRecurrences(supabase);

  const rows = (await listWork(supabase)).filter((r) => !isSnoozed(r));
  const overdue = rows.filter((r) => bucketFor(r) === "overdue");
  const today = rows.filter((r) => bucketFor(r) === "today");
  const asking = overdue.filter((r) => daysOverdue(r) >= 7 && !r.asked_at);

  // Nothing due and nothing late is not worth a notification. A brief that
  // arrives every day regardless is the thing being replaced.
  if (overdue.length === 0 && today.length === 0) {
    return Response.json({ sent: 0, reason: "nothing due" });
  }

  const { data: adminData } = await supabase
    .from("client_users")
    .select("clerk_user_id")
    .eq("role", "admin");
  const admins = ((adminData as { clerk_user_id: string }[] | null) ?? []).map(
    (a) => a.clerk_user_id,
  );
  if (admins.length === 0) return Response.json({ sent: 0, reason: "no admin" });

  const parts: string[] = [];
  if (today.length) parts.push(`${today.length} due today`);
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  if (asking.length) parts.push(`${asking.length} to decide on`);

  // The first few by name, because "7 things due" is a number and "Send
  // Kennewell" is a thing you can picture doing.
  const named = [...overdue, ...today]
    .slice(0, 3)
    .map((r) => r.title)
    .join(" · ");

  let sent = 0;
  for (const recipient of admins) {
    await supabase.from("notifications").insert({
      recipient_user_id: recipient,
      client_id: null,
      type: "work_brief",
      title: parts.join(", "),
      body: named || null,
      link: "/admin",
      channel: "instant",
    });
    sent++;
  }

  return Response.json({
    sent,
    today: today.length,
    overdue: overdue.length,
    asking: asking.length,
  });
}
