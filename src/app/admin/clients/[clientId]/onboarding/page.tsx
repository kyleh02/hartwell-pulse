import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Check, Minus, X } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { PLATFORMS, SECTIONS, answerText, type Answers } from "@/lib/onboarding-shared";
import { BUSINESS_TZ } from "@/lib/business-time";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata = { title: "Onboarding" };

function when(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-AU", {
    timeZone: BUSINESS_TZ,
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A client's onboarding answers, laid out for reading before the kickoff call. */
export default async function ClientOnboardingPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const supabase = await createServerSupabase();
  const [{ data: client }, { data: row, error }] = await Promise.all([
    supabase.from("clients").select("business_name").eq("id", clientId).maybeSingle(),
    supabase.from("onboarding").select("*").eq("client_id", clientId).maybeSingle(),
  ]);
  if (!client) notFound();
  const name = (client as { business_name: string }).business_name;
  const missing = !!error && (error.code === "PGRST205" || error.code === "42P01");
  const ob = row as {
    answers: Answers;
    status: string;
    submitted_at: string | null;
    kickoff_booked_at: string | null;
    updated_at: string;
  } | null;
  const a = ob?.answers ?? {};

  return (
    <div className="max-w-4xl">
      <Link href="/admin/clients" className="mb-5 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim hover:text-pulse-text">
        <ArrowLeft size={15} aria-hidden="true" /> Clients
      </Link>
      <PageHeader
        label={["Clients", name]}
        title="Their onboarding"
        description={
          missing
            ? "Run migration 0055 in Supabase to switch onboarding on."
            : !ob
              ? `${name} hasn't started yet. Their link is /welcome in the portal, and it is on their Home.`
              : ob.status === "submitted"
                ? `Sent to you ${when(ob.submitted_at)}. Last changed ${when(ob.updated_at)}.`
                : `In progress, last saved ${when(ob.updated_at)}. Not sent to you yet.`
        }
      />

      {ob && (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-pulse-text">
            <CalendarCheck size={16} className={ob.kickoff_booked_at ? "text-pulse-success" : "text-pulse-text-mute"} aria-hidden="true" />
            {ob.kickoff_booked_at ? `Kickoff call booked (they said so ${when(ob.kickoff_booked_at)})` : "Kickoff call not booked yet"}
          </p>

          {SECTIONS.filter((s) => s.fields.length > 0 || s.key === "access").map((s) => (
            <section key={s.key} className="rounded-[20px] border border-pulse-border bg-pulse-surface p-6">
              <h2 className="card-title mb-4">{s.title}</h2>
              {s.key === "access" && (
                <ul className="mb-4 divide-y divide-pulse-border">
                  {PLATFORMS.map((p) => {
                    const x = a.access?.[p.key];
                    return (
                      <li key={p.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="text-pulse-text">{p.name}</span>
                        <span className="flex items-center gap-1.5 text-xs">
                          {!x?.uses ? (
                            <span className="inline-flex items-center gap-1 text-pulse-text-mute"><Minus size={13} /> Not used</span>
                          ) : x.added ? (
                            <span className="inline-flex items-center gap-1 text-pulse-success"><Check size={13} /> You've been added</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-pulse-warn"><X size={13} /> Uses it, not added yet</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <dl className="space-y-4">
                {s.fields.map((f) => {
                  const v = answerText(a, f.key).trim();
                  return (
                    <div key={f.key}>
                      <dt className="text-sm font-semibold text-pulse-text">{f.label}</dt>
                      <dd className={v ? "mt-1 text-[15px] leading-relaxed whitespace-pre-wrap text-pulse-text-dim" : "mt-1 text-sm text-pulse-text-mute"}>
                        {v || "Not answered"}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
