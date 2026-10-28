import Link from "next/link";
import { CalendarClock, ShieldOff } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { listLeads } from "@/lib/pipeline";
import { businessToday } from "@/lib/business-time";
import { followUpState, leadTitle, money, shortDate } from "@/lib/pipeline-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { NewLead } from "@/components/pipeline/NewLead";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Pipeline" };

/**
 * Who might become a client, and who to chase today. Today first, because a
 * pipeline is worked from its follow-ups; the board after it.
 */
export default async function PipelinePage() {
  const supabase = await createServerSupabase();
  const today = businessToday();
  const [{ leads, missing }, { count: dnc }] = await Promise.all([
    listLeads(supabase),
    supabase.from("do_not_contact").select("id", { count: "exact", head: true }),
  ]);

  const due = leads
    .filter((l) => ["overdue", "today"].includes(followUpState(l, today)))
    .sort((a, b) => (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? ""));
  const won = leads.filter((l) => l.stage === "won");
  const lost = leads.filter((l) => l.stage === "lost");
  const openValue = leads.filter((l) => !["won", "lost"].includes(l.stage)).reduce((s, l) => s + (Number(l.value) || 0), 0);

  return (
    <div>
      <PageHeader
        label={["Pipeline"]}
        title="Your pipeline"
        description={
          missing
            ? "Run migration 0056 in the Supabase SQL Editor to switch the new pipeline on."
            : `Who might become a client, and who to chase today.${openValue > 0 ? ` ${money(openValue)} in play.` : ""}`
        }
        actions={missing ? undefined : <NewLead />}
      />

      {!missing && (
        <>
          <section className="mb-8 rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="card-title">Follow up today</h2>
              <span className="data-mono text-xs text-pulse-text-mute">{due.length}</span>
            </div>
            {due.length === 0 ? (
              <p className="text-sm text-pulse-text-dim">Nobody to chase today.</p>
            ) : (
              <ul className="divide-y divide-pulse-border">
                {due.map((l) => {
                  const late = followUpState(l, today) === "overdue";
                  return (
                    <li key={l.id}>
                      <Link href={`/admin/pipeline/${l.id}`} className="flex items-center gap-3 py-2.5 hover:text-pulse-gold">
                        <CalendarClock size={15} className={cn("shrink-0", late ? "text-pulse-warn" : "text-pulse-gold")} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-pulse-text">{leadTitle(l)}</span>
                        <span className="hidden min-w-0 flex-1 truncate text-sm text-pulse-text-dim sm:block">{l.next_action ?? ""}</span>
                        <span className={cn("shrink-0 text-xs", late ? "text-pulse-warn" : "text-pulse-text-mute")}>
                          {late ? `Since ${shortDate(l.follow_up_on)}` : "Today"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <PipelineBoard leads={leads} today={today} />

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {[
              { title: "Won", rows: won },
              { title: "Lost", rows: lost },
            ].map((g) => (
              <section key={g.title} className="rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="card-title">{g.title}</h2>
                  <span className="data-mono text-xs text-pulse-text-mute">{g.rows.length}</span>
                </div>
                {g.rows.length === 0 ? (
                  <p className="text-sm text-pulse-text-mute">None yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {g.rows.slice(0, 8).map((l) => (
                      <li key={l.id}>
                        <Link href={`/admin/pipeline/${l.id}`} className="flex items-center justify-between gap-3 text-sm hover:text-pulse-gold">
                          <span className="truncate text-pulse-text">{leadTitle(l)}</span>
                          <span className="shrink-0 text-xs text-pulse-text-mute">
                            {g.title === "Won" ? money(l.value) ?? "" : l.lost_reason ?? ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <Link
            href="/admin/pipeline/do-not-contact"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim hover:text-pulse-text"
          >
            <ShieldOff size={14} aria-hidden="true" /> Do-not-contact list ({dnc ?? 0})
          </Link>
        </>
      )}
    </div>
  );
}
