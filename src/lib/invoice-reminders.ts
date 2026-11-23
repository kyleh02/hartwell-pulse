/**
 * When an overdue invoice is chased, and how firmly (Kyle, 23 November 2026:
 * "from now on 2 days later a more urgent reminder"). Pure; tested in
 * invoice-reminders.test.ts.
 *
 *   1st: the day after it falls due, the gentle nudge.
 *   2nd: two days after the first, firmer: please pay today or say when.
 *   then: the firm one again, once a week, until it's paid.
 *
 * Days are Melbourne calendar days, not hours: a first reminder on Saturday
 * evening makes the firmer one due on Monday, at any time of day. (Counting
 * hours meant a Run pressed on Monday afternoon sent nothing.)
 *
 * `count` is invoices.reminder_count (migration 0069). Before 0069 it's
 * unknown, and the old rule stands: the gentle nudge, weekly.
 */
export type ReminderTone = "gentle" | "urgent";

/** A moment's calendar date in Melbourne, YYYY-MM-DD. */
export function melbourneDay(at: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** Whole days between two YYYY-MM-DD dates (b minus a). */
function dayGap(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function reminderDue(
  count: number | null | undefined,
  lastSentAt: string | null,
  now: Date,
): { due: boolean; tone: ReminderTone } {
  const since = lastSentAt ? dayGap(melbourneDay(lastSentAt), melbourneDay(now)) : Infinity;
  if (count === null || count === undefined) return { due: since >= 7, tone: "gentle" };
  if (count <= 0 || !lastSentAt) return { due: true, tone: "gentle" };
  if (count === 1) return { due: since >= 2, tone: "urgent" };
  return { due: since >= 7, tone: "urgent" };
}

/** Whole days between the due date (YYYY-MM-DD) and today (YYYY-MM-DD). */
export function daysOverdue(dueDate: string, today: string): number {
  return Math.max(0, dayGap(dueDate.slice(0, 10), today.slice(0, 10)));
}
