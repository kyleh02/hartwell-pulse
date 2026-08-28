import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkItem, WorkRow, WorkStep } from "@/lib/work-shared";

/**
 * Reading the work list.
 *
 * One query for items, one for steps, one for client names, stitched here.
 * A join with an embedded select would do it in one round trip and return the
 * steps nested per row, which reads nicely and makes the ordering of steps a
 * property of the query rather than something this file controls. Three plain
 * reads are easier to keep correct.
 */

export interface WorkStrip {
  owed: number;
  overdue: number;
  sendsThisWeek: number;
  reportsDue: number;
  snoozed: number;
  open: number;
}

export async function listWork(
  supabase: SupabaseClient,
  opts: { includeClosed?: boolean } = {},
): Promise<WorkRow[]> {
  let q = supabase.from("work_items").select("*");
  if (!opts.includeClosed) q = q.eq("state", "open");
  const { data: itemData } = await q.order("due_at", { nullsFirst: false });
  const items = (itemData as WorkItem[] | null) ?? [];
  if (items.length === 0) return [];

  const ids = items.map((i) => i.id);
  const clientIds = Array.from(
    new Set(items.map((i) => i.client_id).filter((c): c is string => Boolean(c))),
  );

  const [{ data: stepData }, { data: clientData }] = await Promise.all([
    supabase
      .from("work_item_steps")
      .select("*")
      .in("work_item_id", ids)
      .order("position"),
    clientIds.length
      ? supabase.from("clients").select("id, business_name").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; business_name: string }[] }),
  ]);

  const steps = (stepData as WorkStep[] | null) ?? [];
  const names = new Map(
    ((clientData as { id: string; business_name: string }[] | null) ?? []).map(
      (c) => [c.id, c.business_name],
    ),
  );

  return items.map((i) => ({
    ...i,
    client_name: i.client_id ? (names.get(i.client_id) ?? null) : null,
    steps: steps.filter((s) => s.work_item_id === i.id),
  }));
}

/**
 * The six numbers above the list.
 *
 * Counted rather than derived from the work items, deliberately. Money owed is
 * a fact about invoices, and reading it from whether a chase item happens to
 * exist would make the figure depend on whether a cron ran.
 */
export async function getWorkStrip(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<WorkStrip> {
  const today = now.toISOString().slice(0, 10);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [invoices, sends, reports, items] = await Promise.all([
    supabase.from("invoices").select("total, due_date, status").eq("status", "sent"),
    supabase
      .from("crm_organisations")
      .select("id")
      .eq("brand", "ironpeak")
      .not("scheduled_send_at", "is", null)
      .gte("scheduled_send_at", now.toISOString())
      .lte("scheduled_send_at", weekEnd.toISOString()),
    supabase.from("reports").select("id").eq("status", "draft"),
    supabase.from("work_items").select("state, snoozed_until").eq("state", "open"),
  ]);

  const inv =
    ((invoices.data as { total: number; due_date: string }[] | null) ?? []);
  const open = ((items.data as { snoozed_until: string | null }[] | null) ?? []);

  return {
    owed: inv.reduce((sum, i) => sum + Number(i.total ?? 0), 0),
    overdue: inv
      .filter((i) => i.due_date && i.due_date < today)
      .reduce((sum, i) => sum + Number(i.total ?? 0), 0),
    sendsThisWeek: (sends.data as unknown[] | null)?.length ?? 0,
    reportsDue: (reports.data as unknown[] | null)?.length ?? 0,
    snoozed: open.filter(
      (i) => i.snoozed_until && new Date(i.snoozed_until) > now,
    ).length,
    open: open.length,
  };
}
