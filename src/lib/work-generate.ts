import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    .select("id, invoice_number, client_id, due_date, total, status, clients(business_name)")
    .eq("status", "sent");
  const rows =
    (data as
      | {
          id: string;
          invoice_number: string | null;
          client_id: string;
          due_date: string | null;
          total: number;
          clients: { business_name: string } | { business_name: string }[] | null;
        }[]
      | null) ?? [];

  const items: NewItem[] = [];
  for (const inv of rows) {
    if (!inv.due_date) continue;
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
 * Ironpeak sends that are approved and due.
 *
 * Approved only, deliberately. An unapproved record is not work yet, it is a
 * decision Kyle has not made, and the composer is where that decision belongs.
 * These carry has_time, because 08:47 is the whole point of the schedule.
 */
async function fromCrmSends(supabase: SupabaseClient, now: Date) {
  const { data } = await supabase
    .from("crm_organisations")
    .select("id, legal_name, trading_name, scheduled_send_at, send_approved_at, stage")
    .eq("brand", "ironpeak")
    .not("send_approved_at", "is", null)
    .not("scheduled_send_at", "is", null)
    .in("stage", ["queued", "contacted", "bounced"])
    .lte("scheduled_send_at", new Date(now.getTime() + 86_400_000).toISOString());

  const rows =
    (data as
      | {
          id: string;
          legal_name: string;
          trading_name: string | null;
          scheduled_send_at: string;
        }[]
      | null) ?? [];

  return rows.map((o) => ({
    title: `Send ${o.trading_name ?? o.legal_name}`,
    detail: "Press send in Outlook, then confirm it on the record.",
    brand: "ironpeak" as const,
    due_at: o.scheduled_send_at,
    has_time: true,
    source_kind: "crm_send",
    source_id: o.id,
    source_key: `crm_send:${o.id}:${o.scheduled_send_at.slice(0, 10)}`,
  }));
}

/** Follow-ups, LinkedIn connects, re-verifies: the CRM's own task list. */
async function fromCrmTasks(supabase: SupabaseClient, today: string) {
  const { data } = await supabase
    .from("crm_tasks")
    .select("id, title, due_on, kind, organisation_id, crm_organisations(legal_name, trading_name)")
    .is("done_at", null)
    .lte("due_on", today);

  const rows =
    (data as
      | {
          id: string;
          title: string;
          due_on: string;
          organisation_id: string | null;
          crm_organisations:
            | { legal_name: string; trading_name: string | null }
            | { legal_name: string; trading_name: string | null }[]
            | null;
        }[]
      | null) ?? [];

  return rows.map((t) => {
    const org = Array.isArray(t.crm_organisations)
      ? t.crm_organisations[0]
      : t.crm_organisations;
    return {
      title: t.title,
      detail: org ? (org.trading_name ?? org.legal_name) : null,
      brand: "ironpeak" as const,
      due_at: atNine(t.due_on),
      source_kind: "crm_task",
      source_id: t.id,
      source_key: `crm_task:${t.id}`,
    };
  });
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
  const today = now.toISOString().slice(0, 10);

  const groups: [string, NewItem[]][] = [
    ["invoice", await fromInvoices(supabase, today)],
    ["report", await fromReports(supabase, today)],
    ["crm_send", await fromCrmSends(supabase, now)],
    ["crm_task", await fromCrmTasks(supabase, today)],
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
