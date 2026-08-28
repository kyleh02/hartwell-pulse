import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The work that comes back: monthly reports, the weekly ad check, quarterly
 * BAS, per-client rhythms.
 *
 * A recurrence per client is also the answer to "what counts as a retained
 * client". Nothing has to infer it from services or invoices or a guess: Kyle
 * sets one up once and it is then a fact. A rule that tries to work it out
 * would be wrong about exactly the clients that matter, which are the ones
 * mid-change.
 */

export interface RecurrenceRow {
  id: string;
  title: string;
  detail: string | null;
  client_id: string | null;
  brand: "hartwell" | "ironpeak" | null;
  pattern: "weekly" | "monthly" | "quarterly" | "annual";
  day_of_week: number | null;
  day_of_month: number | null;
  lead_days: number;
  steps: { label: string }[];
  active: boolean;
  last_made_on: string | null;
}

/** The next date this recurrence is due, on or after `from`. */
export function nextDue(r: RecurrenceRow, from: Date): Date {
  const d = new Date(from);
  d.setHours(9, 0, 0, 0);

  if (r.pattern === "weekly") {
    const want = r.day_of_week ?? 1;
    while (d.getDay() !== want) d.setDate(d.getDate() + 1);
    return d;
  }

  const dom = r.day_of_month ?? 1;
  const step = r.pattern === "monthly" ? 1 : r.pattern === "quarterly" ? 3 : 12;
  const c = new Date(from);
  c.setHours(9, 0, 0, 0);
  c.setDate(dom);
  // Already past this period's day, so roll to the next one.
  if (c < from) c.setMonth(c.getMonth() + step);
  return c;
}

/**
 * Stamp out anything whose lead time has arrived.
 *
 * `last_made_on` is the dedup, the same trick the recurring invoices use, so a
 * daily cron that runs twice makes one item. The source key carries the due
 * date as well as the recurrence id, so next month's is a different key and is
 * not blocked by this month's still being open.
 */
export async function materialiseRecurrences(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<{ made: number }> {
  const { data } = await supabase
    .from("work_item_recurrences")
    .select("*")
    .eq("active", true);
  const rows = (data as RecurrenceRow[] | null) ?? [];

  let made = 0;
  for (const r of rows) {
    const due = nextDue(r, now);
    const appearFrom = new Date(due);
    appearFrom.setDate(appearFrom.getDate() - (r.lead_days ?? 0));
    if (now < appearFrom) continue;

    const dueDay = due.toISOString().slice(0, 10);
    if (r.last_made_on === dueDay) continue;

    const { data: created, error } = await supabase
      .from("work_items")
      .insert({
        title: r.title,
        detail: r.detail,
        client_id: r.client_id,
        brand: r.brand,
        due_at: due.toISOString(),
        has_time: false,
        source_kind: "recurring",
        source_id: r.id,
        source_key: `recurring:${r.id}:${dueDay}`,
        state: "open",
      })
      .select("id")
      .single();

    if (error) {
      // Already there for this date. Still record it so the next run skips.
      if (error.code === "23505") {
        await supabase
          .from("work_item_recurrences")
          .update({ last_made_on: dueDay })
          .eq("id", r.id);
      } else {
        console.error(`[recurrence ${r.id}] ${error.message}`);
      }
      continue;
    }

    const itemId = (created as { id: string }).id;
    const steps = Array.isArray(r.steps) ? r.steps : [];
    if (steps.length > 0) {
      await supabase.from("work_item_steps").insert(
        steps
          .filter((s) => s?.label)
          .map((s, i) => ({ work_item_id: itemId, label: s.label, position: i })),
      );
    }

    // Written after the item exists, so a failure halfway leaves the
    // recurrence able to try again rather than believing it is done.
    await supabase
      .from("work_item_recurrences")
      .update({ last_made_on: dueDay })
      .eq("id", r.id);
    made++;
  }

  return { made };
}
