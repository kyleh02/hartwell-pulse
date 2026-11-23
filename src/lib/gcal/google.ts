/**
 * Google Calendar for the portal (Kyle, 23 November 2026): admin@'s calendar,
 * through the same Internal OAuth client as Draper's Gmail. Plain fetch.
 *
 * Scopes: calendar.events (read and write events, nothing else about the
 * calendar or its sharing) and userinfo.email (to prove the account is
 * admin@ before the token is kept).
 */
import type { EventTime } from "./rules.ts";

export const CALENDAR_ACCOUNT = "admin@hartwelldigital.com";
export const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/userinfo.email"];
const API = "https://www.googleapis.com/calendar/v3";

export function calendarAuthUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    login_hint: CALENDAR_ACCOUNT,
    include_granted_scopes: "false",
    state: o.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function accountEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { email?: string };
  return (j.email ?? "").toLowerCase();
}

export interface GEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return { ok: true, data: {} as T };
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) return { ok: false, status: res.status, message: j.error?.message ?? String(res.status) };
  return { ok: true, data: j };
}

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;

/** Events between two moments, recurring ones expanded, in start order. */
export async function listEvents(token: string, calendarId: string, timeMin: string, timeMax: string): Promise<GEvent[]> {
  const out: GEvent[] = [];
  let page: string | undefined;
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250", timeZone: "Australia/Melbourne" });
    if (page) q.set("pageToken", page);
    const r = await call<{ items?: GEvent[]; nextPageToken?: string }>(token, `${cal(calendarId)}/events?${q}`);
    if (!r.ok) throw new Error(`Google Calendar refused: ${r.message}`);
    out.push(...(r.data.items ?? []).filter((e) => e.status !== "cancelled"));
    page = r.data.nextPageToken;
    if (!page) break;
  }
  return out;
}

export interface NewEvent {
  summary: string;
  description?: string;
  start: EventTime;
  end: EventTime;
  colorId?: string;
  pulse?: { kind: string; id: string };
}

function body(e: NewEvent) {
  return JSON.stringify({
    summary: e.summary,
    description: e.description,
    start: e.start,
    end: e.end,
    ...(e.colorId ? { colorId: e.colorId } : {}),
    ...(e.pulse ? { extendedProperties: { private: { pulse: "1", pulseKind: e.pulse.kind, pulseId: e.pulse.id } } } : {}),
  });
}

export async function insertEvent(token: string, calendarId: string, e: NewEvent): Promise<string> {
  const r = await call<{ id: string }>(token, `${cal(calendarId)}/events`, { method: "POST", body: body(e) });
  if (!r.ok) throw new Error(`Google Calendar refused: ${r.message}`);
  return r.data.id;
}

/** Update an event; "gone" when it was deleted in Google meanwhile. */
export async function updateEvent(token: string, calendarId: string, eventId: string, e: NewEvent): Promise<"ok" | "gone"> {
  const r = await call(token, `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: body(e) });
  if (r.ok) return "ok";
  if (r.status === 404 || r.status === 410) return "gone";
  throw new Error(`Google Calendar refused: ${r.message}`);
}

export async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  const r = await call(token, `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`Google Calendar refused: ${r.message}`);
}
