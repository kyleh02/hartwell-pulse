// Where the business is, as far as dates are concerned.
//
// This used to be Australia/Brisbane, hardcoded in a dozen places, because that
// is where Kyle worked from. He now works from Melbourne, which unlike
// Queensland observes daylight saving, so the offset is no longer a constant and
// guessing it is no longer survivable: from 4 October 2026 the state is on AEDT,
// UTC+11.
//
// One constant, imported everywhere, so moving again is one line rather than a
// hunt. Nothing may read a date off toISOString(), which is UTC: between
// midnight and 10 or 11am local, UTC is still on YESTERDAY, so an invoice due
// today reads as overdue and a job that fires at UTC midnight sends on the wrong
// local day.

export const BUSINESS_TZ = "Australia/Melbourne";

/**
 * Today's calendar date where the business is, as YYYY-MM-DD.
 *
 * en-CA because it formats as YYYY-MM-DD, which is the shape every date column
 * and every string comparison in this codebase already uses.
 */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The same date, broken up, for the jobs that need to do arithmetic on it. */
export function businessDateParts(now: Date = new Date()): {
  y: number;
  m: number;
  d: number;
} {
  const [y, m, d] = businessToday(now).split("-").map(Number);
  return { y, m, d };
}

/** Today in the business timezone, shifted by whole days. Still YYYY-MM-DD. */
export function businessDayOffset(days: number, now: Date = new Date()): string {
  const { y, m, d } = businessDateParts(now);
  // Built as a UTC date purely as a calendar, never as an instant, so adding
  // days cannot be bent by a daylight saving change partway through the span.
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
