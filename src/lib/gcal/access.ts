import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openToken, sealToken, tokenKey } from "@/lib/outreach/crypto";
import { refreshAccess, revokeToken } from "@/lib/outreach/gmail";

/**
 * The stored Google Calendar connection (google_calendar, migration 0070,
 * service role only). Callers pass the service-role client after their own
 * admin or cron check. The token is sealed with OUTREACH_TOKEN_KEY, the same
 * key as Draper's Gmail.
 */
export interface CalendarConnection {
  email: string;
  calendar_id: string;
  connected_at: string;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

const missingTable = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205");

/** The connection, null when there isn't one, "no-table" before migration 0070. */
export async function calendarConnection(db: SupabaseClient): Promise<CalendarConnection | null | "no-table"> {
  const { data, error } = await db.from("google_calendar").select("email, calendar_id, connected_at, last_sync_at, last_sync_error").maybeSingle();
  if (missingTable(error)) return "no-table";
  return (data as CalendarConnection | null) ?? null;
}

export async function saveCalendarConnection(db: SupabaseClient, email: string, refreshToken: string, scopes: string[], by: string): Promise<void> {
  const key = tokenKey();
  if (!key) throw new Error("OUTREACH_TOKEN_KEY isn't set, so the token can't be stored safely");
  const { error } = await db.from("google_calendar").upsert({
    id: true,
    email,
    calendar_id: "primary",
    refresh_token_enc: sealToken(refreshToken, key),
    scopes,
    connected_by: by,
    connected_at: new Date().toISOString(),
    last_sync_error: null,
  });
  if (error) throw new Error(missingTable(error) ? "Run migration 0070 in the Supabase SQL Editor first." : `Couldn't store the connection: ${error.message}`);
}

let cached: { token: string; until: number } | null = null;

export async function calendarAccess(db: SupabaseClient): Promise<{ token: string; calendarId: string } | { error: string }> {
  const key = tokenKey();
  if (!key) return { error: "OUTREACH_TOKEN_KEY isn't set" };
  const { data, error } = await db.from("google_calendar").select("refresh_token_enc, calendar_id").maybeSingle();
  if (missingTable(error)) return { error: "Run migration 0070 first." };
  if (error) return { error: error.message };
  if (!data) return { error: "Google Calendar isn't connected." };
  const row = data as { refresh_token_enc: string; calendar_id: string };
  if (cached && cached.until > Date.now()) return { token: cached.token, calendarId: row.calendar_id };
  try {
    const token = await refreshAccess(openToken(row.refresh_token_enc, key));
    cached = { token, until: Date.now() + 45 * 60_000 };
    return { token, calendarId: row.calendar_id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function disconnectCalendar(db: SupabaseClient): Promise<void> {
  const key = tokenKey();
  const { data } = await db.from("google_calendar").select("refresh_token_enc").maybeSingle();
  if (data && key) {
    try {
      await revokeToken(openToken((data as { refresh_token_enc: string }).refresh_token_enc, key));
    } catch {
      // A token that won't open can't be revoked; deleting it is still right.
    }
  }
  cached = null;
  // The links go too: a later connection starts a fresh set of events.
  await db.from("calendar_links").delete().neq("event_id", "");
  await db.from("google_calendar").delete().eq("id", true);
}
