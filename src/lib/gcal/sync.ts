import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMoney, outstandingOf } from "@/lib/invoices-shared";
import type { Invoice } from "@/lib/types/database";
import { calendarAccess } from "./access";
import { deleteEvent, insertEvent, updateEvent, type NewEvent } from "./google";
import { fingerprint, invoiceItem, leadItem, planSync, workItem, type CalendarLink, type PortalItem } from "./rules";

/** At most this many calls to Google per sync: the rest wait for the next. */
const MAX_CHANGES = 60;

function asEvent(i: PortalItem): NewEvent {
  return { summary: i.title, description: i.description, start: i.start, end: i.end, colorId: i.colorId, pulse: { kind: i.kind, id: i.id } };
}

/** Every portal item that should be on the calendar now. */
async function desiredItems(db: SupabaseClient, origin: string): Promise<PortalItem[]> {
  const [{ data: invs }, { data: clients }, { data: leads }, { data: work }] = await Promise.all([
    db.from("invoices").select("*").eq("status", "sent").is("split_at", null).not("due_date", "is", null),
    db.from("clients").select("id, business_name"),
    db.from("leads").select("id, name, business, follow_up_on, next_action, stage").not("stage", "in", "(won,lost)").not("follow_up_on", "is", null),
    db.from("work_items").select("id, title, detail, due_at, has_time, source_kind").eq("state", "open").not("due_at", "is", null).not("source_kind", "in", "(invoice,lead)"),
  ]);
  const names = new Map(((clients as { id: string; business_name: string }[] | null) ?? []).map((c) => [c.id, c.business_name]));
  const out: PortalItem[] = [];
  for (const inv of (invs as Invoice[] | null) ?? []) {
    if (inv.recurring_active) continue;
    out.push(invoiceItem(inv as Invoice & { due_date: string }, names.get(inv.client_id) ?? "A client", formatMoney(outstandingOf(inv)), origin));
  }
  for (const l of (leads as { id: string; name: string | null; business: string | null; follow_up_on: string; next_action: string | null }[] | null) ?? []) {
    out.push(leadItem(l, origin));
  }
  for (const w of (work as { id: string; title: string; detail: string | null; due_at: string; has_time: boolean }[] | null) ?? []) {
    out.push(workItem(w, origin));
  }
  return out;
}

/**
 * Make admin@'s calendar match the portal's dated items. Runs from the
 * 15-minute email job and from "Sync now". Never throws: the outcome is
 * recorded on the connection for the Settings card.
 */
export async function syncCalendar(db: SupabaseClient, origin: string): Promise<{ inserted: number; updated: number; removed: number; error?: string }> {
  const done = { inserted: 0, updated: 0, removed: 0 };
  const access = await calendarAccess(db);
  if ("error" in access) return { ...done, error: access.error };
  const { token, calendarId } = access;
  try {
    const [desired, { data: linkRows, error: lErr }] = await Promise.all([
      desiredItems(db, origin),
      db.from("calendar_links").select("source_kind, source_id, event_id, fingerprint"),
    ]);
    if (lErr) throw new Error(lErr.message);
    const plan = planSync(desired, (linkRows as CalendarLink[] | null) ?? []);
    let budget = MAX_CHANGES;
    for (const l of plan.remove) {
      if (budget-- <= 0) break;
      await deleteEvent(token, calendarId, l.event_id);
      await db.from("calendar_links").delete().eq("source_kind", l.source_kind).eq("source_id", l.source_id);
      done.removed++;
    }
    for (const u of plan.update) {
      if (budget-- <= 0) break;
      let eventId = u.eventId;
      // Deleted in Google meanwhile: put it back, since the portal still has it.
      if ((await updateEvent(token, calendarId, u.eventId, asEvent(u.item))) === "gone") eventId = await insertEvent(token, calendarId, asEvent(u.item));
      await db.from("calendar_links").update({ event_id: eventId, fingerprint: fingerprint(u.item), synced_at: new Date().toISOString() }).eq("source_kind", u.item.kind).eq("source_id", u.item.id);
      done.updated++;
    }
    for (const i of plan.insert) {
      if (budget-- <= 0) break;
      const eventId = await insertEvent(token, calendarId, asEvent(i));
      const { error } = await db.from("calendar_links").insert({ source_kind: i.kind, source_id: i.id, event_id: eventId, fingerprint: fingerprint(i) });
      // The link failed to save: take the event back out, or the next run adds a second.
      if (error) await deleteEvent(token, calendarId, eventId);
      else done.inserted++;
    }
    await db.from("google_calendar").update({ last_sync_at: new Date().toISOString(), last_sync_error: null }).eq("id", true);
    return done;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("google_calendar").update({ last_sync_at: new Date().toISOString(), last_sync_error: msg.slice(0, 500) }).eq("id", true);
    return { ...done, error: msg };
  }
}
