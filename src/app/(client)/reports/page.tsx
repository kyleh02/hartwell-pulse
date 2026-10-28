import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Download, FileText } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { listClientReports } from "@/lib/reports";
import { monthLabel } from "@/lib/metrics";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClasses } from "@/components/ui/Button";

export const metadata = { title: "Reports" };

/** The opening lines of a report, as plain text: the summary's Markdown stripped. */
function excerpt(summary: string | null, max = 220): string | null {
  if (!summary) return null;
  const text = summary
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[#>\-*\d.|\s]+/gm, "")
    .replace(/\*\*|__|\*|_|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function published(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-AU", {
    timeZone: "Australia/Melbourne",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * The client's reports. The newest leads as one large card with the PDF a tap
 * away, because "the latest report" is what someone opening this page wants
 * nine times in ten; the rest follow as a grid.
 */
export default async function ReportsPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const reports = await listClientReports(supabase, session.clientId);
  const [latest, ...earlier] = reports;

  return (
    <div>
      <PageHeader
        label={["Reports"]}
        title="Your monthly reports"
        description="How your marketing is going, month by month. Read any report here or download it as a PDF."
      />

      {!latest ? (
        <EmptyState
          icon={<FileText size={20} strokeWidth={1.75} />}
          title="No reports yet"
          description="Your first report will appear here once it is published. You will get a heads up when it is ready."
        />
      ) : (
        <>
          <section
            className="relative overflow-hidden rounded-[20px] border border-pulse-gold/30 bg-pulse-surface p-6 sm:p-9"
            style={{
              backgroundImage:
                "radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--pulse-gold) 14%, transparent) 0%, transparent 60%)",
            }}
          >
            <p className="eyebrow">Latest report · {monthLabel(latest.period_month)}</p>
            <h2 className="mt-3 text-[24px] leading-[1.08] font-extrabold tracking-[-0.01em] text-pulse-text uppercase sm:text-[32px]">
              {latest.title}
            </h2>
            <div className="gold-rule mt-5 mb-4 max-w-xl" aria-hidden="true" />
            {excerpt(latest.summary) && (
              <p className="max-w-2xl text-[15px] leading-relaxed text-pulse-text-dim">{excerpt(latest.summary)}</p>
            )}
            {published(latest.published_at) && (
              <p className="mt-2 text-xs text-pulse-text-mute">Published {published(latest.published_at)}</p>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href={`/reports/${latest.id}`} className={buttonClasses("primary", "md")}>
                Read the report <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <a href={`/reports/${latest.id}/pdf`} className={buttonClasses("secondary", "md")}>
                <Download size={15} aria-hidden="true" /> Download PDF
              </a>
            </div>
          </section>

          {earlier.length > 0 && (
            <>
              <h2 className="eyebrow mt-10 mb-4">Earlier reports</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {earlier.map((r) => (
                  <div key={r.id} className="lift group flex flex-col rounded-[20px] border border-pulse-border bg-pulse-surface p-6">
                    <p className="mono-label">{monthLabel(r.period_month)}</p>
                    <Link
                      href={`/reports/${r.id}`}
                      className="mt-2 text-[16px] font-extrabold tracking-[0.02em] text-pulse-text uppercase transition-colors group-hover:text-pulse-gold after:absolute after:inset-0"
                    >
                      {r.title}
                    </Link>
                    <div className="relative mt-auto flex items-center justify-between pt-5">
                      <span className="text-[11px] font-bold tracking-[0.16em] text-pulse-gold uppercase">Read it</span>
                      <a
                        href={`/reports/${r.id}/pdf`}
                        aria-label={`Download ${r.title} as a PDF`}
                        className="relative z-10 flex h-9 w-9 items-center justify-center rounded-[2px] text-pulse-text-mute transition-colors hover:bg-pulse-surface-2 hover:text-pulse-gold"
                      >
                        <Download size={16} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
