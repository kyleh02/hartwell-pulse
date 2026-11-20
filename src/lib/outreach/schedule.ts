/**
 * When Draper sends (Stage 5), as pure functions of the clock, tested in
 * schedule.test.ts. Every time here is Melbourne time (decision: the brief's
 * window is Melbourne's 9:30am to 3:30pm), worked out per date because
 * daylight saving moves the offset.
 *
 * A sending day is a weekday that isn't a public holiday in Victoria or in
 * the recipient's state, isn't in the pause dates, and is in a year the
 * holiday table covers. The day's queue is fixed at 8am and summarised; the
 * first send waits out the stop window; sends are 20 to 45 minutes apart at
 * random; "Check these" (the 13th first email on) go no earlier than 12:30pm;
 * anything that won't fit before 3:30pm rolls to the next sending day.
 */
import { AU_HOLIDAYS } from "./data/au-holidays.ts";
import { CHECK_THESE_FROM } from "./limits.ts";

export const SUMMARY_AT = "08:00";
const TZ = "Australia/Melbourne";

export interface Calendar {
  holidays: Record<string, Record<string, string[]>>;
  pauseFrom: string | null;
  pauseTo: string | null;
}

export function calendar(pauseFrom: string | null, pauseTo: string | null): Calendar {
  return { holidays: AU_HOLIDAYS, pauseFrom, pauseTo };
}

/** The Melbourne date of a moment, YYYY-MM-DD. */
export function melbourneDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The Melbourne time of a moment, HH:MM (24 hour). */
export function melbourneTime(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 Sunday to 6 Saturday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** The moment it is HH:MM in Melbourne on a date, daylight saving included. */
export function melbourneInstant(date: string, hhmm: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const want = minutes(hhmm);
  // Start from AEST (UTC+10) and correct by what Melbourne's clock says.
  let t = Date.UTC(y, mo - 1, d, 0, want) - 10 * 3600_000;
  for (let i = 0; i < 3; i++) {
    const at = new Date(t);
    const [ly, lm, ld] = melbourneDate(at).split("-").map(Number);
    const dayDiff = (Date.UTC(ly, lm - 1, ld) - Date.UTC(y, mo - 1, d)) / 86_400_000;
    const off = dayDiff * 1440 + minutes(melbourneTime(at)) - want;
    if (off === 0) break;
    t -= off * 60_000;
  }
  return new Date(t);
}

export type DayCheck = { ok: true } | { ok: false; reason: string };

/** Whether Draper may send on a date to someone in `state` (null: Victoria only). */
export function sendingDay(date: string, state: string | null, cal: Calendar): DayCheck {
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return { ok: false, reason: "a weekend" };
  const year = cal.holidays[date.slice(0, 4)];
  if (!year) return { ok: false, reason: `no public holiday dates are loaded for ${date.slice(0, 4)}` };
  if (year.VIC?.includes(date)) return { ok: false, reason: "a public holiday in Victoria" };
  if (state && state !== "VIC" && year[state]?.includes(date)) return { ok: false, reason: `a public holiday in ${state}` };
  if (cal.pauseFrom && cal.pauseTo && date >= cal.pauseFrom && date <= cal.pauseTo) return { ok: false, reason: "in the pause dates" };
  return { ok: true };
}

/** The first sending day strictly after `date`, within two months, or null. */
export function nextSendingDay(date: string, state: string | null, cal: Calendar): string | null {
  for (let i = 1; i <= 62; i++) {
    const d = addDays(date, i);
    if (sendingDay(d, state, cal).ok) return d;
  }
  return null;
}

/** The follow-up's day: seven days after the first went, or the next sending day after that. */
export function followUpDay(firstSent: string, state: string | null, cal: Calendar): string | null {
  const day7 = addDays(firstSent, 7);
  return sendingDay(day7, state, cal).ok ? day7 : nextSendingDay(day7, state, cal);
}

export interface PlanItem {
  id: string;
  /** No earlier than this Melbourne time, e.g. "Check these" from 12:30. */
  notBefore?: string;
}

export interface PlanInput {
  date: string;
  windowStart: string;
  windowEnd: string;
  gapMin: number;
  gapMax: number;
  stopWindowMinutes: number;
  /** When the queue was fixed and summarised, if later than 8am (after a pause, say). */
  fixedAt?: string;
  items: PlanItem[];
  /** 0 to 1; Math.random in use, seeded in tests. */
  random: () => number;
}

/**
 * Send times for a day's queue, in order. The first waits for the window and
 * for the stop window after the 8am summary, plus up to ten minutes so it
 * isn't on the dot; each later one is a random gap after the one before.
 * Anything that won't fit before the window closes is rolled over.
 */
export function planDay(p: PlanInput): { times: { id: string; at: Date }[]; rolledOver: string[] } {
  const summary = Math.max(minutes(SUMMARY_AT), p.fixedAt ? minutes(p.fixedAt) : 0);
  const start = Math.max(minutes(p.windowStart), summary + p.stopWindowMinutes);
  const end = minutes(p.windowEnd);
  const times: { id: string; at: Date }[] = [];
  const rolledOver: string[] = [];
  let at = start + Math.floor(p.random() * 11);
  let first = true;
  for (const item of p.items) {
    if (!first) at += p.gapMin + Math.floor(p.random() * (p.gapMax - p.gapMin + 1));
    if (item.notBefore) at = Math.max(at, minutes(item.notBefore));
    if (at > end) {
      rolledOver.push(item.id);
      continue;
    }
    first = false;
    const hh = String(Math.floor(at / 60)).padStart(2, "0");
    const mm = String(at % 60).padStart(2, "0");
    times.push({ id: item.id, at: melbourneInstant(p.date, `${hh}:${mm}`) });
  }
  return { times, rolledOver };
}

/** "Check these" go no earlier than this. */
export const CHECK_THESE_NOT_BEFORE = CHECK_THESE_FROM;

export type Recipient = { to: string; test: boolean } | { blocked: string };

/**
 * Who an email goes to (decision 2). Test mode sends everything to Kyle's test
 * inboxes, whatever the master switch says, which is how the end-to-end test
 * runs. A real business is reached only with the master switch ON and test
 * mode OFF, both by Kyle's hand.
 */
export function recipientFor(
  s: { master_on: boolean; test_mode: boolean; test_inboxes: string[] },
  realEmail: string,
  n: number,
): Recipient {
  if (s.test_mode) {
    const inboxes = s.test_inboxes.filter(Boolean);
    if (inboxes.length === 0) return { blocked: "Test mode is on but no test inboxes are set" };
    return { to: inboxes[Math.abs(n) % inboxes.length], test: true };
  }
  if (!s.master_on) return { blocked: "The master switch is off" };
  return { to: realEmail, test: false };
}
