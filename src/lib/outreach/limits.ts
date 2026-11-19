/**
 * How much Draper may send in a day. Pure arithmetic, tested in
 * limits.test.ts.
 *
 * These are the numbers a bad Claude run, a wrong setting or a bug elsewhere
 * must never get past, so they are constants, not settings. The database holds
 * the slider to 1 to 25 as well (0062).
 */

/** First emails a day, whatever the slider says. */
export const MAX_FIRST_EMAILS_A_DAY = 25;

/** Every send in a day, follow-ups included. */
export const MAX_SENDS_A_DAY = 50;

/** From the 13th first email of a day, messages go in "Check these". */
export const CHECK_THESE_AFTER = 12;

/** "Check these" messages are scheduled from 12:30pm Melbourne time. */
export const CHECK_THESE_FROM = "12:30";

/**
 * The warm-up: 5 a day for the first 5 sending days, then 10, 15 and 20,
 * rising every 5 sending days. After that the slider decides.
 */
export const RAMP = [5, 10, 15, 20] as const;
export const RAMP_STEP_DAYS = 5;

/** A whole number, or the fallback when it is not a number at all. */
function whole(n: number, fallback: number): number {
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/**
 * The ramp's cap for the next sending day, or null once the mailbox has warmed
 * up. `sendingDaysDone` counts the weekdays on which at least one first email
 * has already gone out (Stage 5 counts them from outreach_messages).
 */
export function rampCap(sendingDaysDone: number): number | null {
  const step = Math.floor(Math.max(0, whole(sendingDaysDone, 0)) / RAMP_STEP_DAYS);
  return step < RAMP.length ? RAMP[step] : null;
}

/**
 * First emails the next sending day may carry: the lower of the slider and the
 * ramp, never above the hard ceiling and never below one. A slider that is not
 * a number counts as one, the safe end.
 */
export function firstEmailCap(slider: number, sendingDaysDone: number): number {
  const wanted = Math.min(MAX_FIRST_EMAILS_A_DAY, Math.max(1, whole(slider, 1)));
  const ramp = rampCap(sendingDaysDone);
  return ramp === null ? wanted : Math.min(wanted, ramp);
}

/**
 * First emails that actually go, once follow-ups are counted. Follow-ups come
 * first: if they would push the day past 50 sends, first emails give way.
 */
export function firstEmailsToday(cap: number, followUpsDue: number): number {
  const room = MAX_SENDS_A_DAY - Math.max(0, whole(followUpsDue, MAX_SENDS_A_DAY));
  return Math.max(0, Math.min(whole(cap, 0), MAX_FIRST_EMAILS_A_DAY, room));
}

/** Whether the nth first email of a day (counting from 1) goes in "Check these". */
export function isCheckThese(nth: number): boolean {
  return whole(nth, 0) > CHECK_THESE_AFTER;
}
