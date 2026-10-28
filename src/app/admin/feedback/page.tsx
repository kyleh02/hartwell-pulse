import Link from "next/link";
import { Star } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { BUSINESS_TZ, businessToday } from "@/lib/business-time";
import { npsSettings, planRound, type Survey } from "@/lib/nps";
import { group, npsOf, quarterOf } from "@/lib/nps-shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { NpsChart, type NpsQuarter } from "@/components/nps/NpsChart";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Feedback" };

const signed = (n: number | null) => (n === null ? "None yet" : n > 0 ? `+${n}` : `${n}`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: BUSINESS_TZ, day: "numeric", month: "short", year: "numeric" });

const CHIP = {
  promoter: "border-pulse-gold/50 bg-pulse-gold/15 text-pulse-gold",
  passive: "border-pulse-border bg-pulse-surface-2 text-pulse-text",
  detractor: "border-pulse-danger/50 bg-pulse-danger/10 text-pulse-danger",
} as const;
const GROUP_LABEL = { promoter: "Promoter", passive: "Passive", detractor: "Detractor" } as const;

/**
 * How clients rate Hartwell Digital: the score over the last year, its trend
 * by quarter, and every answer with its reason. The arithmetic is in
 * lib/nps-shared.ts.
 */
export default async function FeedbackPage() {
  const supabase = await createServerSupabase();
  const [{ data, error }, { data: clientRows }, { data: people }, settings] = await Promise.all([
    supabase.from("nps_surveys").select("*").order("created_at", { ascending: false }),
    supabase.from("clients").select("id, business_name"),
    supabase.from("client_users").select("clerk_user_id, full_name"),
    npsSettings(supabase),
  ]);
  const missing = !!error && (error.code === "PGRST205" || error.code === "42P01");
  const surveys = (data as Survey[] | null) ?? [];
  const names = new Map(((clientRows as { id: string; business_name: string }[] | null) ?? []).map((c) => [c.id, c.business_name]));
  const who = new Map(((people as { clerk_user_id: string; full_name: string | null }[] | null) ?? []).map((p) => [p.clerk_user_id, p.full_name]));

  const yearAgo = Date.now() - 365 * 86_400_000;
  const answered = surveys.filter((s) => s.answered_at && s.score !== null);
  const recent = answered.filter((s) => Date.parse(s.answered_at!) >= yearAgo);
  const year = npsOf(recent.map((s) => s.score!));
  const askedRecent = surveys.filter((s) => Date.parse(s.created_at) >= yearAgo);
  const rate = askedRecent.length ? Math.round((askedRecent.filter((s) => s.answered_at).length / askedRecent.length) * 100) : null;
  const waiting = surveys.filter((s) => !s.answered_at && Date.parse(s.closes_at) > Date.now()).length;
  const reviews = surveys.filter((s) => s.review_asked_at).length;
  const lowLately = answered.filter((s) => s.score! <= 6 && Date.parse(s.answered_at!) >= Date.now() - 90 * 86_400_000).length;

  const byQuarter = new Map<string, { label: string; short: string; scores: number[] }>();
  for (const s of answered) {
    const q = quarterOf(businessToday(new Date(s.answered_at!)));
    const e = byQuarter.get(q.key) ?? { label: q.label, short: q.short, scores: [] };
    e.scores.push(s.score!);
    byQuarter.set(q.key, e);
  }
  const quarters: NpsQuarter[] = [...byQuarter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([key, v]) => ({ key, label: v.label, short: v.short, nps: npsOf(v.scores).nps ?? 0, total: v.scores.length }));

  const plan = !missing && !settings.enabled ? await planRound(supabase) : null;

  return (
    <div>
      <PageHeader
        label={["Feedback"]}
        title="Client feedback"
        description="One question to every client, 30 days in and then each quarter: how likely are they to recommend you?"
      />

      {missing ? (
        <p className="rounded-[16px] border border-pulse-border bg-pulse-surface p-5 text-sm text-pulse-text-dim">
          Run migration 0058 in the Supabase SQL Editor to switch feedback on.
        </p>
      ) : (
        <>
          {!settings.enabled && (
            <div className="mb-6 rounded-[16px] border border-pulse-gold/40 bg-pulse-gold/[0.06] p-5 text-sm leading-relaxed text-pulse-text-dim">
              <p className="text-pulse-text">
                Surveys are switched off, so nobody has been asked yet.{" "}
                <Link href="/admin/settings" className="font-semibold text-pulse-gold underline-offset-4 hover:underline">
                  Switch them on in Settings
                </Link>
                .
              </p>
              {plan && plan.length > 0 && (
                <p className="mt-2">
                  The first morning after, {plan.reduce((n, r) => n + r.people.length, 0)} people would be asked:{" "}
                  {plan.map((r) => r.businessName).join(", ")}.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div
              className="rounded-[20px] border border-pulse-gold/30 bg-pulse-surface p-6 sm:col-span-2 lg:row-span-2"
              style={{ backgroundImage: "radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--pulse-gold) 14%, transparent) 0%, transparent 60%)" }}
            >
              <p className="text-[52px] leading-none font-extrabold tracking-[-0.02em] text-pulse-text">{signed(year.nps)}</p>
              <p className="mt-3 text-sm text-pulse-text-dim">
                Your score over the last 12 months{year.total ? `, from ${year.total} answer${year.total === 1 ? "" : "s"}` : ""}. It runs from -100 to +100.
              </p>
              <div className="gold-rule my-5" aria-hidden="true" />
              <div className="grid grid-cols-3 gap-4">
                {(
                  [
                    ["promoters", year.promoters, "Promoters, 9 to 10"],
                    ["passives", year.passives, "Passive, 7 to 8"],
                    ["detractors", year.detractors, "Detractors, 0 to 6"],
                  ] as const
                ).map(([k, n, label]) => (
                  <div key={k}>
                    <p className="text-2xl font-extrabold text-pulse-text">{n}</p>
                    <p className="text-xs text-pulse-text-mute">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            {(
              [
                [rate === null ? "None yet" : `${rate}%`, "Answered, of everyone asked this year"],
                [String(waiting), "Waiting for an answer"],
                [String(reviews), "Asked for a Google review"],
                [String(lowLately), "Scored 6 or under in the last 90 days"],
              ] as const
            ).map(([n, label]) => (
              <div key={label} className="rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
                <p className="text-[28px] leading-none font-extrabold text-pulse-text">{n}</p>
                <p className="mt-2 text-sm text-pulse-text-dim">{label}</p>
              </div>
            ))}
          </div>

          <section className="mt-6 rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
            <h2 className="card-title mb-4">Score by quarter</h2>
            {quarters.length ? (
              <NpsChart quarters={quarters} />
            ) : (
              <p className="text-sm text-pulse-text-dim">The trend appears here once the first answers are in.</p>
            )}
          </section>

          <section className="mt-6">
            <h2 className="card-title mb-3">Every answer</h2>
            {answered.length === 0 ? (
              <p className="rounded-[16px] border border-pulse-border bg-pulse-surface p-5 text-sm text-pulse-text-dim">No answers yet.</p>
            ) : (
              <ul className="space-y-2">
                {answered.map((s) => {
                  const g = group(s.score!);
                  return (
                    <li key={s.id} className="flex gap-4 rounded-[16px] border border-pulse-border bg-pulse-surface p-4">
                      <span className={cn("data-mono flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border text-lg font-bold", CHIP[g])}>
                        {s.score}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-pulse-text">
                          {names.get(s.client_id) ?? "A former client"}
                          <span className="font-normal text-pulse-text-dim">
                            {" "}
                            · {who.get(s.user_id) ?? s.email ?? "Someone"} · {GROUP_LABEL[g]}
                          </span>
                        </p>
                        {s.comment ? (
                          <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-pulse-text">{s.comment}</p>
                        ) : (
                          <p className="mt-1 text-sm text-pulse-text-mute">No reason given.</p>
                        )}
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-pulse-text-mute">
                          {day(s.answered_at!)}, {s.answered_via === "email" ? "from the email" : "in the portal"}
                          {s.review_asked_at && (
                            <span className="inline-flex items-center gap-1 text-pulse-gold">
                              <Star size={11} aria-hidden="true" /> shown your review link
                            </span>
                          )}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
