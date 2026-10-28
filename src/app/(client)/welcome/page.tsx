import Image from "next/image";
import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { DEFAULT_WELCOME, NEXT_STEPS, type Answers } from "@/lib/onboarding-shared";
import { HARTWELL } from "@/lib/brand";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { SetPasswordCard } from "@/components/home/SetPasswordCard";

export const metadata = { title: "Welcome" };

/**
 * Where a new client starts: a welcome from Kyle, what happens next, and the
 * onboarding form. Linked from Home until it is done, and from the welcome
 * email; anyone can come back to it later to change an answer.
 */
export default async function WelcomePage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const [{ data: row, error }, { data: client }, { data: settings }] = await Promise.all([
    supabase.from("onboarding").select("answers, status, kickoff_booked_at").eq("client_id", session.clientId).maybeSingle(),
    supabase.from("clients").select("business_name").eq("id", session.clientId).maybeSingle(),
    // Kyle's own settings hold bank details, so only the two fields this page
    // needs are taken, server side. select("*") tolerates 0055 not yet run.
    createAdminSupabase().from("business_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const ready = !error || !(error.code === "PGRST205" || error.code === "42P01");
  const ob = row as { answers: Answers; status: string; kickoff_booked_at: string | null } | null;
  const s = (settings ?? {}) as { kickoff_url?: string | null; welcome_message?: string | null };
  const first = session.profile?.full_name?.trim().split(/\s+/)[0] ?? null;
  const business = (client as { business_name: string } | null)?.business_name ?? "your business";

  return (
    <div className="space-y-8">
      <SetPasswordCard />
      {/* ---- the welcome, from Kyle ---- */}
      <section
        className="relative overflow-hidden rounded-[20px] border border-pulse-border bg-pulse-surface p-6 sm:p-9"
        style={{
          backgroundImage:
            "radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--pulse-gold) 16%, transparent) 0%, transparent 55%)",
        }}
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <Image
            src="/images/kyle.webp"
            alt={`${HARTWELL.person}, Hartwell Digital`}
            width={112}
            height={140}
            priority
            className="h-28 w-28 shrink-0 rounded-full border-2 border-pulse-gold/40 object-cover object-top"
          />
          <div className="min-w-0">
            <h1 className="text-[28px] leading-[1.04] font-extrabold tracking-[-0.01em] text-pulse-text uppercase sm:text-[38px]">
              Welcome aboard{first ? <>, <span className="text-pulse-gold">{first}</span></> : null}
            </h1>
            <div className="gold-rule mt-4 mb-4 max-w-md" aria-hidden="true" />
            <p className="max-w-2xl text-[15px] leading-relaxed whitespace-pre-wrap text-pulse-text-dim">
              {s.welcome_message?.trim() || DEFAULT_WELCOME}
            </p>
            <p className="mt-3 text-sm font-semibold text-pulse-text">
              {HARTWELL.personFirst}, {HARTWELL.name}
            </p>
          </div>
        </div>
      </section>

      {/* ---- what happens next ---- */}
      <section>
        <h2 className="card-title mb-4">What happens next for {business}</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {NEXT_STEPS.map((step, i) => (
            <li key={step.title} className="rounded-[20px] border border-pulse-border bg-pulse-surface p-5">
              <span className="text-[34px] leading-none font-extrabold text-pulse-gold/30">{String(i + 1).padStart(2, "0")}</span>
              <p className="mt-3 text-[15px] font-extrabold tracking-[0.02em] text-pulse-text uppercase">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-pulse-text-dim">{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      {ready ? (
        <OnboardingFlow
          initial={ob?.answers ?? {}}
          submitted={ob?.status === "submitted"}
          kickoffBooked={!!ob?.kickoff_booked_at}
          kickoffUrl={s.kickoff_url?.trim() || null}
        />
      ) : (
        <p className="rounded-[16px] border border-pulse-border bg-pulse-surface p-5 text-sm text-pulse-text-dim">
          Your onboarding form will be ready here shortly. In the meantime, say hello from the chat bubble.
        </p>
      )}
    </div>
  );
}
