import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A nudge for the things that have a clock on them.
 *
 * The morning brief covers the day. It cannot cover an Ironpeak send at 08:47,
 * because by the time the brief is read the send may be hours off, and a
 * scheduled minute is the one thing on this list that genuinely cannot wait.
 *
 * Only items where `has_time` is true, and each is nudged ONCE. `nudged_at` is
 * what makes that true: without it the hourly cron would announce the same
 * send every hour until it closed, which is the nagging this whole rebuild
 * exists to end.
 */
export async function nudgeTimedItems(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<number> {
  // Due in the last hour or the next ten minutes. The window looks backwards
  // because the cron runs on the hour and a send at 08:47 must be announced on
  // the 09:00 pass rather than missed for being in the past.
  const from = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("work_items")
    .select("id, title, detail")
    .eq("state", "open")
    .eq("has_time", true)
    .is("nudged_at", null)
    .gte("due_at", from)
    .lte("due_at", to);
  const items = (data as { id: string; title: string; detail: string | null }[] | null) ?? [];
  if (items.length === 0) return 0;

  const { data: adminData } = await supabase
    .from("client_users")
    .select("clerk_user_id")
    .eq("role", "admin");
  const admins = ((adminData as { clerk_user_id: string }[] | null) ?? []).map(
    (a) => a.clerk_user_id,
  );
  if (admins.length === 0) return 0;

  let sent = 0;
  for (const item of items) {
    for (const recipient of admins) {
      await supabase.from("notifications").insert({
        recipient_user_id: recipient,
        client_id: null,
        type: "work_brief",
        title: `Now: ${item.title}`,
        body: item.detail,
        link: "/admin",
        channel: "instant",
      });
    }
    // Stamped after the send, so a failure part way leaves it to try again
    // rather than believing it was announced.
    await supabase
      .from("work_items")
      .update({ nudged_at: new Date().toISOString() })
      .eq("id", item.id);
    sent++;
  }
  return sent;
}
