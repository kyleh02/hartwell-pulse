/**
 * Client feedback (0058): the arithmetic, shared by the server, the admin page
 * and the tests. Kept pure.
 *
 * NPS is the percentage of promoters (9 or 10) minus the percentage of
 * detractors (0 to 6), so it runs from -100 to 100. Passives (7 or 8) count in
 * the total and in neither group, which is what makes the score honest.
 */

export const FIRST_AFTER_DAYS = 30;
export const EVERY_DAYS = 91;
/** How long a survey stays open on Home before it quietly goes away. */
export const OPEN_DAYS = 21;

export type NpsGroup = "promoter" | "passive" | "detractor";

export function group(score: number): NpsGroup {
  return score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";
}

export function npsOf(scores: number[]): { nps: number | null; promoters: number; passives: number; detractors: number; total: number } {
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const total = scores.length;
  return {
    nps: total ? Math.round(((promoters - detractors) / total) * 100) : null,
    promoters,
    passives: total - promoters - detractors,
    detractors,
    total,
  };
}

/** Calendar quarter of a business date: "Oct to Dec 2026", "Q4 2026" for an axis, sortable by key. */
export function quarterOf(dateKey: string): { key: string; label: string; short: string } {
  const y = Number(dateKey.slice(0, 4));
  const q = Math.floor((Number(dateKey.slice(5, 7)) - 1) / 3);
  const names = ["Jan to Mar", "Apr to Jun", "Jul to Sep", "Oct to Dec"];
  return { key: `${y}-Q${q + 1}`, label: `${names[q]} ${y}`, short: `Q${q + 1} ${y}` };
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * Is a client due to be asked today? The first round comes 30 days after they
 * started (their onboarding being sent, or failing that the day they were
 * added); after that, 91 days after the last round. Dates are business dates.
 */
export function dueKind(startKey: string, lastRoundKey: string | null, todayKey: string): "first" | "quarterly" | null {
  if (!lastRoundKey) return days(startKey, todayKey) >= FIRST_AFTER_DAYS ? "first" : null;
  return days(lastRoundKey, todayKey) >= EVERY_DAYS ? "quarterly" : null;
}

export const QUESTION = "How likely are you to recommend Hartwell Digital to a friend or colleague?";
