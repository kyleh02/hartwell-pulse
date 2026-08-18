import "server-only";

/**
 * The seven sends nobody can vouch for.
 *
 * Part H scheduled 16 sends across Wednesday 12 to Monday 17 August 2026, and
 * version 4 of the handoff says the portal must not assume any of them either
 * sent or did not. Reading the database on 18 August narrowed that considerably.
 *
 * Only seven were ever approved and drafted. The cron put each one in the
 * Outlook Drafts folder within about three minutes of its scheduled time, on
 * the 12th and 13th, and then stopped: everything scheduled for Friday the 14th
 * and Monday the 17th was never approved, so no draft was ever created for it.
 * The portal's only send path is Kyle pressing send on a draft, so a record
 * with no draft has nothing that could have been sent. Those nine are not in
 * doubt and are deliberately NOT flagged. Warning about all sixteen when only
 * seven are genuinely uncertain is how a warning gets ignored.
 *
 * The touch log settles nothing here: it holds seven outbound touches in total,
 * the last on 11 August, so nothing at all was logged for this window.
 *
 * WRITTEN DOWN RATHER THAN QUERIED, and that is the point. This evidence lives
 * in `draft_created_at`, and replacing the pipeline clears that column so a
 * rewritten body can draft again. The moment "Load v4 pipeline" is pressed the
 * database can no longer answer the question. Captured here on 18 August 2026,
 * from the rows themselves, before that happened.
 */

export interface UnresolvedDraft {
  /** When Part H planned it. */
  scheduled: string;
  /** When the cron actually put it in the Drafts folder. */
  drafted: string;
}

/** Australian eastern time. Keyed by legal name, lowercased. */
const DRAFTED_UNCONFIRMED: ReadonlyMap<string, UnresolvedDraft> = new Map([
  ["kennewell pty ltd", {
    scheduled: "2026-08-12T08:47:00+10:00", drafted: "2026-08-12T10:50:18+10:00",
  }],
  ["lintek pty limited", {
    scheduled: "2026-08-12T10:26:00+10:00", drafted: "2026-08-12T11:00:32+10:00",
  }],
  ["one ocean group pty ltd", {
    scheduled: "2026-08-12T11:24:00+10:00", drafted: "2026-08-12T11:25:14+10:00",
  }],
  ["micron manufacturing pty ltd", {
    scheduled: "2026-08-12T14:23:00+10:00", drafted: "2026-08-12T14:25:15+10:00",
  }],
  ["owen international pty ltd", {
    scheduled: "2026-08-13T08:52:00+10:00", drafted: "2026-08-13T08:55:15+10:00",
  }],
  ["decem pty ltd", {
    scheduled: "2026-08-13T11:47:00+10:00", drafted: "2026-08-13T11:50:20+10:00",
  }],
  ["process rubber and plastics (prp manufacturing)", {
    scheduled: "2026-08-13T15:07:00+10:00", drafted: "2026-08-13T15:10:19+10:00",
  }],
]);

/** Nothing was logged from here on, which is what makes the seven unknown. */
const WINDOW_OPENS = Date.parse("2026-08-12T00:00:00+10:00");

export interface TouchLike {
  direction: string;
  sent_at: string;
}

/**
 * The unresolved draft for a company, or null when there is nothing in doubt.
 *
 * An outbound touch dated on or after the window opened settles it: the touch
 * log is the record of what actually went, so once a send is logged the
 * question is answered and the flag goes. That is also the only way to clear
 * it, deliberately. There is nowhere to record "I checked, it did not send"
 * without a migration, and inventing a dismiss button that writes nothing would
 * be worse than leaving the flag up.
 */
export function unresolvedDraft(
  company: string,
  touches: readonly TouchLike[],
): UnresolvedDraft | null {
  const draft = DRAFTED_UNCONFIRMED.get(company.trim().toLowerCase());
  if (!draft) return null;
  const settled = touches.some(
    (t) => t.direction === "out" && Date.parse(t.sent_at) >= WINDOW_OPENS,
  );
  return settled ? null : draft;
}

/** Every company still carrying an unknown outcome, for the plan's banner. */
export function unresolvedDrafts(
  rows: readonly { legal_name: string; touches?: readonly TouchLike[] }[],
): { company: string; draft: UnresolvedDraft }[] {
  return rows
    .map((r) => ({
      company: r.legal_name,
      draft: unresolvedDraft(r.legal_name, r.touches ?? []),
    }))
    .filter((r): r is { company: string; draft: UnresolvedDraft } =>
      Boolean(r.draft),
    )
    .sort((a, b) => a.draft.drafted.localeCompare(b.draft.drafted));
}
