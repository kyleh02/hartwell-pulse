/**
 * The nine pre-send checks.
 *
 * ONE list, imported by both the manual log-a-send flow and the automated
 * composer. They used to be two copies of the same array, which meant the
 * automated path could quietly become the easy way to skip a check.
 *
 * Three were rewritten on 10 August when the version 3 handoff landed:
 *
 *  - c4 and c5 asked for "a finding specific to their technical domain" and
 *    "at least one positive finding". That was the capability-statement offer,
 *    where the shape was "here is something good about you, and here is a
 *    gap". The 7 August repositioning replaced it with one checkable fault, a
 *    second observation and a generic offer. A check nobody can honestly tick
 *    is worse than no check, because ticking it anyway is a habit that spreads.
 *
 *  - c6 asked whether the opt-out line was present. It is appended
 *    automatically now and cannot be left off, so the real risk inverted: a
 *    body pasted in with its own signature already attached, which then goes
 *    out with two.
 */
export const PRESEND_CHECKS: readonly (readonly [string, string])[] = [
  ["c1", "The name is a real one from their own page, or the greeting is the fallback"],
  ["c2", "Every figure, date and quoted phrase copied verbatim from their site"],
  ["c3", "Every 'not findable' line actually searched today"],
  ["c4", "The fault is on their own site and they can check it themselves in a minute"],
  ["c5", "The fault was verified in a rendering browser, not by text extraction"],
  ["c6", "The body carries no signature or opt-out of its own, both are appended"],
  ["c7", "Address is the one published verbatim on their page, not constructed"],
  ["c8", "Screenshot of their contact page saved and dated"],
  ["c9", "One sentence here could not have been sent to any other company"],
];
