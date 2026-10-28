import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { businessToday } from "@/lib/business-time";
import { isSuperseded } from "@/lib/invoices-shared";

/**
 * Turning what the portal already knows into work.
 *
 * Every generator is idempotent through the partial unique index on
 * (source_kind, source_key) where state = 'open'. That is what lets this run
 * hourly without becoming the notification problem again: a second open item
 * for the same stage of the same thing is refused by the database rather than
 * by remembering to check.
 *
 * The key carries a STAGE, not just a row id. "invoice:<id>:due" and
 * "invoice:<id>:overdue7" are different work about the same invoice, which is
 * how Not doing can suppress one nag without suppressing the invoice: drop the
 * seven-day chase and the thirty-day one still arrives, because it is a
 * different key.
 */

export interface GenerateResult {
  made: number;
  byKind: Record<string, number>;
}

interface NewItem {
  title: string;
  detail?: string | null;
  client_id?: string | null;
  brand?: "hartwell" | "ironpeak" | null;
  due_at: string | null;
  has_time?: boolean;
  source_kind: string;
  source_id?: string | null;
  source_key: string;
}

/**
 * Insert, ignoring the ones that already exist.
 *
 * The conflict is expected and is the mechanism, not an error. Inserted one at
 * a time so a single duplicate does not lose the whole batch, which matters
 * when the batch is "everything due today".
 */
async function insertMissing(
  supabase: SupabaseClient,
  items: NewItem[],
): Promise<number> {
  let made = 0;
  for (const item of items) {
    const { error } = await supabase.from("work_items").insert({
      ...item,
      has_time: item.has_time ?? false,
      state: "open",
    });
    // 23505 is unique_violation: this stage already has an open item, which is
    // exactly what the index is for. Anything else is worth knowing about.
    if (!error) made++;
    else if (error.code !== "23505") {
      console.error(`[work] ${item.source_key}: ${error.message}`);
    }
  }
  return made;
}

function atNine(date: string): string {
  return new Date(`${date}T09:00:00+10:00`).toISOString();
}

/** Invoices: one item three days out, another at seven days overdue, then thirty. */
async function fromInvoices(supabase: SupabaseClient, today: string) {
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_number, client_id, due_date, total, status, deposit_amount, split_at, clients(business_name)")
    .eq("status", "sent");
  const rows =
    (data as
      | {
          id: string;
          invoice_number: string | null;
          client_id: string;
          due_date: string | null;
          total: number;
          deposit_amount: number | null;
          split_at: string | null;
          clients: { business_name: string } | { business_name: string }[] | null;
        }[]
      | null) ?? [];

  const items: NewItem[] = [];
  for (const inv of rows) {
    if (!inv.due_date) continue;
    // A split invoice is chased through its instalments, which are invoices in
    // their own right and generate their own items.
    if (isSuperseded(inv)) continue;
    const client = Array.isArray(inv.clients) ? inv.clients[0] : inv.clients;
    const name = client?.business_name ?? "a client";
    const days = Math.round(
      (new Date(today).getTime() - new Date(inv.due_date).getTime()) / 86_400_000,
    );

    const base = {
      client_id: inv.client_id,
      brand: "hartwell" as const,
      source_kind: "invoice",
      source_id: inv.id,
    };

    if (days >= 30) {
      items.push({
        ...base,
        title: `${inv.invoice_number} is a month overdue, ${name}`,
        detail: "Thirty days. Worth a phone call rather than another email.",
        due_at: atNine(today),
        source_key: `invoice:${inv.id}:overdue30`,
      });
    } else if (days >= 7) {
      items.push({
        ...base,
        title: `Chase ${inv.invoice_number}, ${name}`,
        detail: "A week overdue.",
        due_at: atNine(today),
        source_key: `invoice:${inv.id}:overdue7`,
      });
    } else if (days >= 0) {
      items.push({
        ...base,
        title: `${inv.invoice_number} is due, ${name}`,
        due_at: atNine(today),
        source_key: `invoice:${inv.id}:due`,
      });
    } else if (days >= -3) {
      items.push({
        ...base,
        title: `${inv.invoice_number} falls due soon, ${name}`,
        due_at: atNine(inv.due_date),
        source_key: `invoice:${inv.id}:soon`,
      });
    }
  }
  return items;
}

/** Reports sitting in draft, so a month's work does not quietly not happen. */
async function fromReports(supabase: SupabaseClient, today: string) {
  const { data } = await supabase
    .from("reports")
    .select("id, title, client_id, status, period_month, clients(business_name)")
    .eq("status", "draft");
  const rows =
    (data as
      | {
          id: string;
          title: string;
          client_id: string;
          period_month: string;
          clients: { business_name: string } | { business_name: string }[] | null;
        }[]
      | null) ?? [];

  return rows.map((r) => {
    const client = Array.isArray(r.clients) ? r.clients[0] : r.clients;
    return {
      title: `Finish and send ${r.title}`,
      detail: client?.business_name ?? null,
      client_id: r.client_id,
      brand: "hartwell" as const,
      due_at: atNine(today),
      source_kind: "report",
      source_id: r.id,
      source_key: `report:${r.id}:draft`,
    };
  });
}

/**
 * Leads whose follow-up date has come. One item per lead per date, so moving
 * the date on (or ticking it off and setting the next one) raises the next
 * follow-up when its day comes, and never a second item for the same day.
 */
async function fromLeads(supabase: SupabaseClient, today: string): Promise<NewItem[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, name, business, follow_up_on, next_action")
    .not("stage", "in", "(won,lost)")
    .not("follow_up_on", "is", null)
    .lte("follow_up_on", today);
  if (error) return []; // 0056 not run yet
  return ((data as { id: string; name: string | null; business: string | null; follow_up_on: string; next_action: string | null }[] | null) ?? []).map((l) => ({
    title: `Follow up ${l.business || l.name || "a lead"}`,
    detail: l.next_action,
    brand: "hartwell" as const,
    due_at: atNine(l.follow_up_on),
    source_kind: "lead",
    source_id: l.id,
    source_key: `lead:${l.id}:${l.follow_up_on}`,
  }));
}

/**
 * Run every generator.
 *
 * Ordered so the cheapest queries run first, which matters only if one of them
 * fails: the ones already done have already inserted.
 */
export async function generateWorkItems(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<GenerateResult> {
  const today = businessToday(now);

  const groups: [string, NewItem[]][] = [
    ["invoice", await fromInvoices(supabase, today)],
    ["report", await fromReports(supabase, today)],
    ["lead", await fromLeads(supabase, today)],
  ];

  const byKind: Record<string, number> = {};
  let made = 0;
  for (const [kind, items] of groups) {
    const n = await insertMissing(supabase, items);
    byKind[kind] = n;
    made += n;
  }
  return { made, byKind };
}
