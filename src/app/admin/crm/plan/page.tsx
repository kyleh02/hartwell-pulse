import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { SendPlan, type PlanRow } from "@/components/crm/SendPlan";
import { ScheduleTable } from "@/components/crm/ScheduleTable";
import { AutoSchedule } from "@/components/crm/AutoSchedule";
import { unresolvedDrafts } from "@/lib/crm-unresolved";

export const metadata = { title: "Send plan" };

/**
 * The pipeline as a run sheet.
 *
 * The board answers "where is everything"; this answers "what am I doing
 * today". Those are different questions and the board was being made to serve
 * both badly. Ordered by the day each email is due to go, with the overdue
 * follow-ups first because a missed window is the one thing that cannot be
 * caught up later.
 */
export default async function SendPlanPage() {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("crm_organisations")
    .select(
      "id, legal_name, trading_name, state, domain, rank, priority_tier, channel, stage, scheduled_send_at, scheduled_at, followup_due, hook, hook_verified_at, hard_warning, send_approved_at, send_attempted_at, send_error, email_body, draft_created_at, graph_web_link, crm_contacts(first_name, surname, role_title, email_as_published, name_verified, fallback_greeting)",
    )
    .eq("brand", "ironpeak")
    .order("rank");

  // Every outbound touch, in one query rather than one per row.
  //
  // The touch log is what "sent" means. The plan used to read
  // `send_attempted_at`, which only `markSent` ever writes, so anything logged
  // through the manual flow stayed on the board as still to do however long ago
  // it went. Copamate and NH Micro went on 30 July and were still sitting there
  // as work. The log is the record the Spam Act defence rests on, so it is also
  // the right thing to tick a row off with.
  const { data: touchData } = await supabase
    .from("crm_touches")
    .select("organisation_id, direction, sent_at, outcome")
    .eq("direction", "out");
  const touchesByOrg = new Map<
    string,
    { direction: string; sent_at: string; outcome: string }[]
  >();
  for (const t of (touchData as
    | { organisation_id: string; direction: string; sent_at: string; outcome: string }[]
    | null) ?? []) {
    const list = touchesByOrg.get(t.organisation_id) ?? [];
    list.push({ direction: t.direction, sent_at: t.sent_at, outcome: t.outcome });
    touchesByOrg.set(t.organisation_id, list);
  }

  /**
   * The last time something actually reached someone.
   *
   * A bounce is excluded, and that is the same rule the two-email cap uses: the
   * recipient never saw it, so it is an attempt rather than a send and the row
   * still has work on it.
   */
  const sentAtFor = (orgId: string): string | null => {
    const landed = (touchesByOrg.get(orgId) ?? []).filter(
      (t) => t.outcome !== "bounce",
    );
    if (landed.length === 0) return null;
    return landed.reduce((a, b) => (a.sent_at > b.sent_at ? a : b)).sent_at;
  };

  const unresolved = unresolvedDrafts(
    ((data as PlanRow[] | null) ?? []).map((r) => ({
      legal_name: r.legal_name,
      touches: touchesByOrg.get(r.id) ?? [],
    })),
  );

  const rows = ((data as PlanRow[] | null) ?? []).map((r) => ({
    ...r,
    sent_at: sentAtFor(r.id),
    // Supabase returns the embedded table as an array; there is one contact
    // per company by design, so flatten it here rather than in the component.
    contact: Array.isArray(r.crm_contacts) ? r.crm_contacts[0] : r.crm_contacts,
  }));

  return (
    <div>
      <Link
        href="/admin/crm"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ArrowLeft size={15} strokeWidth={1.75} />
        Pipeline
      </Link>

      <PageHeader
        label={["Ironpeak", "Send plan"]}
        title="Send plan"
        description="What to do today, then the days after it. Approved emails go on their own at the time shown."
      />

      {/* Before anything else, the sends nobody can vouch for. Each of these
          had a finished draft put in Outlook on 12 or 13 August and no send
          logged after it. Shown at the top because deciding what to do next
          depends on it. */}
      {unresolved.length > 0 && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-pulse-warn/40 bg-pulse-warn/10 p-4">
          <p className="mono-label text-pulse-warn">Send status unknown</p>
          <p className="mt-1.5 max-w-2xl text-xs text-pulse-warn">
            {unresolved.length} records had a finished draft put in Outlook on
            12 and 13 August, and nothing was ever logged against them. Each one
            is either still sitting in Drafts unsent, or it went and was never
            recorded. Check Sent Items and log the ones that went, so a second
            copy of the same cold email does not follow the first. The rest of
            that week never got as far as a draft, so it is only these.
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-pulse-warn">
            {unresolved.map((u) => (
              <li key={u.company} className="data-mono">
                {u.company}
                {" · drafted "}
                {new Date(u.draft.drafted).toLocaleString("en-AU", {
                  timeZone: "Australia/Brisbane",
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The whole schedule first, then today's work. "When is everything
          going out" and "what do I do now" are different questions and the
          day-grouped view only answered the second one. */}
      <div className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="mono-label">Everything scheduled</h2>
          <AutoSchedule />
        </div>
        <ScheduleTable rows={rows} />
      </div>

      <SendPlan rows={rows} />
    </div>
  );
}
