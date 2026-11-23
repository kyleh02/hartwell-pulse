/**
 * When an overdue invoice is chased, and how firmly (Kyle, 23 November 2026:
 * "from now on 2 days later a more urgent reminder"). Pure; tested in
 * invoice-reminders.test.ts.
 *
 *   1st: the day after it falls due, the gentle nudge.
 *   2nd: two days after the first, firmer: please pay today or say when.
 *   then: the firm one again, once a week, until it's paid.
 *
 * `count` is invoices.reminder_count (migration 0069). Before Kyle runs 0069
 * it's unknown, and the old rule stands: the gentle nudge, weekly.
 */
export type ReminderTone = "gentle" | "urgent";

const HOUR = 3_600_000;
// The job runs once a day at the same hour, so "two days" is just under 48
// hours: a run a few minutes early must not slip it a whole day.
const SECOND_AFTER_HOURS = 47;
const WEEKLY_HOURS = 7 * 24 - 1;

export function reminderDue(
  count: number | null | undefined,
  lastSentAt: string | null,
  now: Date,
): { due: boolean; tone: ReminderTone } {
  const since = lastSentAt ? (now.getTime() - Date.parse(lastSentAt)) / HOUR : Infinity;
  if (count === null || count === undefined) return { due: since >= WEEKLY_HOURS, tone: "gentle" };
  if (count <= 0 || !lastSentAt) return { due: true, tone: "gentle" };
  if (count === 1) return { due: since >= SECOND_AFTER_HOURS, tone: "urgent" };
  return { due: since >= WEEKLY_HOURS, tone: "urgent" };
}

/** Whole days between the due date (YYYY-MM-DD) and today (YYYY-MM-DD). */
export function daysOverdue(dueDate: string, today: string): number {
  return Math.max(0, Math.round((Date.parse(`${today.slice(0, 10)}T00:00:00Z`) - Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`)) / (24 * HOUR)));
}
