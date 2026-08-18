import "server-only";
import { PIPELINE_V2 } from "@/lib/crm-pipeline-v2";

/**
 * The sends nobody can currently vouch for.
 *
 * Part H scheduled 16 sends across Wednesday 12 to Monday 17 August 2026.
 * Nothing wrote back to the handoff after the 11th, the Microsoft 365 tenant is
 * blocked so Sent Items cannot be opened, and Kyle's recollection is that some
 * of them went but not which. Version 4 of the handoff is explicit that the
 * portal must not assume either way.
 *
 * So this exists to make sure nobody is relying on memory at the moment it
 * matters. A duplicate cold email is worse than a late one: it is the message
 * that tells a prospect this was never really written for them, and it is the
 * one that gets a complaint rather than a reply.
 *
 * Derived from the pipeline file rather than stored, deliberately. Pressing
 * "Lay out the schedule" overwrites `scheduled_send_at` with new times, which
 * would erase the only evidence of which records sat in that window. The
 * handoff does not move, so this survives a reschedule.
 *
 * It WARNS, it does not block. A record that genuinely did not send must still
 * be approvable tomorrow, and there is nowhere yet to record "confirmed not
 * sent" without a migration that is not applied. The flag clears itself the
 * honest way instead: log the send and the touch answers the question.
 */

/** Australian eastern time, the whole of the 12th to the end of the 17th. */
const WINDOW_OPENS = Date.parse("2026-08-12T00:00:00+10:00");
const WINDOW_CLOSES = Date.parse("2026-08-18T00:00:00+10:00");

const SCHEDULED_IN_WINDOW = new Map<string, string>(
  PIPELINE_V2.filter((r) => {
    if (!r.scheduledSendAt) return false;
    const t = Date.parse(r.scheduledSendAt);
    return t >= WINDOW_OPENS && t < WINDOW_CLOSES;
  }).map((r) => [r.company.toLowerCase(), r.scheduledSendAt as string]),
);

export interface TouchLike {
  direction: string;
  sent_at: string;
}

/**
 * The scheduled time whose outcome is unknown, or null when there is nothing
 * to worry about.
 *
 * An outbound touch dated on or after the window opened settles it: the touch
 * log is the record of what actually went, so if one exists the send is not a
 * mystery. Anything earlier belongs to a previous round and says nothing about
 * this week.
 */
export function unresolvedSendAt(
  company: string,
  touches: readonly TouchLike[],
): string | null {
  const scheduled = SCHEDULED_IN_WINDOW.get(company.trim().toLowerCase());
  if (!scheduled) return null;
  const confirmed = touches.some(
    (t) => t.direction === "out" && Date.parse(t.sent_at) >= WINDOW_OPENS,
  );
  return confirmed ? null : scheduled;
}

/** Every company still carrying an unknown outcome, for the plan's banner. */
export function unresolvedCompanies(
  rows: readonly { legal_name: string; touches?: readonly TouchLike[] }[],
): { company: string; scheduled: string }[] {
  return rows
    .map((r) => ({
      company: r.legal_name,
      scheduled: unresolvedSendAt(r.legal_name, r.touches ?? []),
    }))
    .filter((r): r is { company: string; scheduled: string } =>
      Boolean(r.scheduled),
    )
    .sort((a, b) => a.scheduled.localeCompare(b.scheduled));
}
