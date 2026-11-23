/**
 * The portal's items as Google Calendar events, and what a sync has to do to
 * make the calendar match (Kyle, 23 November 2026). Pure; rules.test.ts.
 *
 * Synced: sent invoices' due dates (not split, not recurring templates),
 * open leads' follow-ups, and open work items with a due date that the
 * portal didn't make from an invoice or a lead (those are already here as
 * the invoice or the lead; syncing both would show everything twice).
 */

export const TIME_ZONE = "Australia/Melbourne";

export type ItemKind = "invoice" | "lead" | "work_item";
export type EventTime = { date: string } | { dateTime: string; timeZone: string };

export interface PortalItem {
  kind: ItemKind;
  id: string;
  title: string;
  description: string;
  start: EventTime;
  end: EventTime;
  /** Google's colour ids: 5 banana for money, 9 blueberry for leads, 2 sage for work. */
  colorId: string;
}

export interface CalendarLink {
  source_kind: ItemKind;
  source_id: string;
  event_id: string;
  fingerprint: string;
}

/** YYYY-MM-DD plus n days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A moment's calendar date in Melbourne. */
export function melbourneDate(at: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

function allDay(date: string): { start: EventTime; end: EventTime } {
  return { start: { date }, end: { date: addDays(date, 1) } };
}

export function invoiceItem(
  inv: { id: string; invoice_number: string; due_date: string },
  client: string,
  amount: string,
  origin: string,
): PortalItem {
  return {
    kind: "invoice",
    id: inv.id,
    title: `Invoice ${inv.invoice_number} due: ${client}, ${amount}`,
    description: `Unpaid when Pulse last looked. Leaves the calendar when it's marked paid or voided.\n${origin}/admin/invoices/${inv.id}`,
    ...allDay(inv.due_date.slice(0, 10)),
    colorId: "5",
  };
}

export function leadItem(lead: { id: string; name: string | null; business: string | null; follow_up_on: string; next_action: string | null }, origin: string): PortalItem {
  const who = lead.name?.trim() || lead.business?.trim() || "a lead";
  const at = lead.name?.trim() && lead.business?.trim() ? ` (${lead.business.trim()})` : "";
  return {
    kind: "lead",
    id: lead.id,
    title: `Follow up: ${who}${at}`,
    description: `${lead.next_action?.trim() ? `${lead.next_action.trim()}\n` : ""}${origin}/admin/pipeline/${lead.id}`,
    ...allDay(lead.follow_up_on.slice(0, 10)),
    colorId: "9",
  };
}

export function workItem(w: { id: string; title: string; detail: string | null; due_at: string; has_time: boolean }, origin: string): PortalItem {
  const description = `${w.detail?.trim() ? `${w.detail.trim()}\n` : ""}${origin}/admin`;
  if (w.has_time) {
    const start = new Date(w.due_at);
    const end = new Date(start.getTime() + 30 * 60_000);
    return {
      kind: "work_item",
      id: w.id,
      title: w.title,
      description,
      start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
      end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
      colorId: "2",
    };
  }
  return { kind: "work_item", id: w.id, title: w.title, description, ...allDay(melbourneDate(w.due_at)), colorId: "2" };
}

/** What a change to an item looks like: if this differs, the event is updated. */
export function fingerprint(i: PortalItem): string {
  return JSON.stringify([i.title, i.description, i.start, i.end, i.colorId]);
}

/** The work to make the calendar match the portal. */
export function planSync(desired: PortalItem[], links: CalendarLink[]): {
  insert: PortalItem[];
  update: { item: PortalItem; eventId: string }[];
  remove: CalendarLink[];
} {
  const key = (kind: string, id: string) => `${kind}:${id}`;
  const linked = new Map(links.map((l) => [key(l.source_kind, l.source_id), l]));
  const wanted = new Set(desired.map((d) => key(d.kind, d.id)));
  const insert: PortalItem[] = [];
  const update: { item: PortalItem; eventId: string }[] = [];
  for (const d of desired) {
    const l = linked.get(key(d.kind, d.id));
    if (!l) insert.push(d);
    else if (l.fingerprint !== fingerprint(d)) update.push({ item: d, eventId: l.event_id });
  }
  const remove = links.filter((l) => !wanted.has(key(l.source_kind, l.source_id)));
  return { insert, update, remove };
}
