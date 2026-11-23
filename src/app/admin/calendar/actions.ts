"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { calendarAccess, disconnectCalendar } from "@/lib/gcal/access";
import { insertEvent } from "@/lib/gcal/google";
import { addDays, TIME_ZONE } from "@/lib/gcal/rules";
import { syncCalendar } from "@/lib/gcal/sync";
import { requestOrigin } from "@/lib/mcp/http";

type Result = { ok: true; message?: string } | { ok: false; message: string };

async function guard() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Melbourne wall-clock time as an RFC 3339 instant Google reads in TIME_ZONE. */
function local(date: string, time: string) {
  return { dateTime: `${date}T${time}:00`, timeZone: TIME_ZONE };
}

/** Add an event to admin@'s Google Calendar. It's Kyle's own: the portal never changes or removes it. */
export async function addCalendarEvent(input: {
  title: string;
  date: string;
  allDay: boolean;
  start?: string;
  end?: string;
  notes?: string;
}): Promise<Result> {
  await guard();
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, message: "Give it a title." };
  if (!DATE.test(input.date)) return { ok: false, message: "Pick a date." };
  const notes = input.notes?.trim().slice(0, 2000) || undefined;
  let start, end;
  if (input.allDay) {
    start = { date: input.date };
    end = { date: addDays(input.date, 1) };
  } else {
    if (!TIME.test(input.start ?? "") || !TIME.test(input.end ?? "")) return { ok: false, message: "Give a start and end time, or tick All day." };
    if ((input.end as string) <= (input.start as string)) return { ok: false, message: "The end time needs to be after the start." };
    start = local(input.date, input.start!);
    end = local(input.date, input.end!);
  }
  const access = await calendarAccess(createAdminSupabase());
  if ("error" in access) return { ok: false, message: access.error };
  try {
    await insertEvent(access.token, access.calendarId, { summary: title, description: notes, start, end });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
  return { ok: true };
}

/** Put the portal's dated items on the calendar now, rather than within 15 minutes. */
export async function syncCalendarNow(): Promise<Result> {
  await guard();
  const r = await syncCalendar(createAdminSupabase(), await requestOrigin());
  revalidatePath("/admin/settings");
  revalidatePath("/admin/calendar");
  if (r.error) return { ok: false, message: r.error };
  return { ok: true, message: `Synced: ${r.inserted} added, ${r.updated} updated, ${r.removed} removed.` };
}

/** Disconnect: revoke the token and forget it. Events already in Google stay there. */
export async function disconnectGoogleCalendar(): Promise<Result> {
  await guard();
  await disconnectCalendar(createAdminSupabase());
  revalidatePath("/admin/settings");
  revalidatePath("/admin/calendar");
  return { ok: true };
}
