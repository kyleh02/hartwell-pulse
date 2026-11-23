import "server-only";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { calendarAccess, calendarConnection } from "./access";
import { listEvents, type GEvent } from "./google";
import { addDays, melbourneDate, TIME_ZONE } from "./rules";

/** An event as the portal shows it. */
export interface CalEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD the event starts on, Melbourne. */
  day: string;
  /** YYYY-MM-DD the event ends on (inclusive), for all-day events that span days. */
  lastDay: string;
  allDay: boolean;
  /** "9:30am", or null for all day. */
  time: string | null;
  endTime: string | null;
  location: string | null;
  link: string | null;
  /** Set when the event is one of the portal's own items. */
  pulse: { kind: string; id: string } | null;
}

const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/\s/g, "").toLowerCase();

function shape(e: GEvent): CalEvent {
  const allDay = !!e.start.date;
  const day = allDay ? e.start.date! : melbourneDate(e.start.dateTime!);
  const lastDay = allDay ? addDays(e.end.date ?? e.start.date!, -1) : melbourneDate(e.end.dateTime ?? e.start.dateTime!);
  const p = e.extendedProperties?.private;
  const pulseKind = p?.pulse === "1" ? p.pulseKind : undefined;
  const pulseId = p?.pulse === "1" ? p.pulseId : undefined;
  return {
    id: e.id,
    title: e.summary?.trim() || "(No title)",
    day,
    lastDay: lastDay < day ? day : lastDay,
    allDay,
    time: allDay ? null : clock(e.start.dateTime!),
    endTime: allDay || !e.end.dateTime ? null : clock(e.end.dateTime),
    location: e.location ?? null,
    link: e.htmlLink ?? null,
    pulse: pulseKind && pulseId ? { kind: pulseKind, id: pulseId } : null,
  };
}

export type CalendarState =
  | { state: "no-table" }
  | { state: "not-connected" }
  | { state: "error"; message: string }
  | { state: "ok"; email: string; events: CalEvent[] };

/** Admin@'s events from one Melbourne date to another (inclusive). Admins only. */
export async function calendarEvents(from: string, to: string): Promise<CalendarState> {
  const session = await getPulseSession();
  if (session?.role !== "admin") return { state: "error", message: "Admins only" };
  const db = createAdminSupabase();
  const conn = await calendarConnection(db);
  if (conn === "no-table") return { state: "no-table" };
  if (!conn) return { state: "not-connected" };
  const access = await calendarAccess(db);
  if ("error" in access) return { state: "error", message: access.error };
  try {
    // Melbourne midnight to midnight, as instants Google understands.
    const start = new Date(`${from}T00:00:00+11:00`);
    const end = new Date(`${addDays(to, 1)}T00:00:00+11:00`);
    start.setUTCHours(start.getUTCHours() - 2);
    end.setUTCHours(end.getUTCHours() + 2);
    const events = (await listEvents(access.token, access.calendarId, start.toISOString(), end.toISOString()))
      .map(shape)
      .filter((e) => e.lastDay >= from && e.day <= to);
    return { state: "ok", email: conn.email, events };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
