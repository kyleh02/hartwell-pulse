import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  getCrmMetrics,
  getCrmSettings,
  listCrmLists,
  listActivityDays,
  listDueTasks,
  listProspects,
} from "@/lib/crm";
import { PageHeader } from "@/components/ui/PageHeader";
import { CrmHealth } from "@/components/crm/CrmHealth";
import { PipelineView } from "@/components/crm/PipelineView";
import { ReplacePipeline } from "@/components/crm/ReplacePipeline";
import { CalendarClock } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Pipeline" };

const BRANDS = [
  {
    key: "ironpeak",
    label: "Ironpeak Consulting",
    blurb:
      "Australian defence suppliers. Outreach here follows the defence playbook: two emails then stop, and a first email is blocked until the note carries a finding specific to their technical domain.",
  },
  {
    key: "hartwell",
    label: "Hartwell Digital",
    blurb:
      "The general client base. The Spam Act consent trail still applies, but the defence playbook's two-email cap and note gates do not.",
  },
] as const;

export default async function AdminCrmPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const { brand: raw } = await searchParams;
  const brand = raw === "hartwell" ? "hartwell" : "ironpeak";
  const current = BRANDS.find((b) => b.key === brand)!;

  const supabase = await createServerSupabase();

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [rows, metrics, settings, dueTasks, lists, activity] = await Promise.all([
    listProspects(supabase, brand),
    getCrmMetrics(supabase, 7, brand),
    getCrmSettings(supabase),
    listDueTasks(supabase, today),
    listCrmLists(supabase, brand),
    listActivityDays(supabase, 14, brand),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        label={[current.label, "Outreach"]}
        title="Pipeline"
        description="Who you are reaching out to, grouped by where the names came from, and where each one sits. The rules are enforced rather than displayed: a send is blocked until its consent trail is complete."
        actions={
          brand === "ironpeak" ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Link
                href="/admin/crm/plan"
                className={buttonClasses("secondary", "sm")}
              >
                <CalendarClock size={14} /> Send plan
              </Link>
              {/* One load button, on purpose. "Sync master list" and the seed
                  importers applied the superseded 59 and 76 record datasets and
                  would have resurrected the companies that were triaged out;
                  they are gone, along with the data files behind them. Load
                  does both jobs: it applies the live list and clears what is
                  not on it, and it creates what it cannot find, so it works
                  from an empty pipeline too. */}
              <ReplacePipeline />
            </div>
          ) : undefined
        }
      />

      {/* Two businesses, two client bases, two sets of numbers. Kept apart so a
          reply rate from one never gets averaged into the other. */}
      <div className="inline-flex rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface p-1">
        {BRANDS.map((b) => (
          <Link
            key={b.key}
            href={`/admin/crm?brand=${b.key}`}
            className={cn(
              "rounded-[6px] px-3 py-1.5 text-sm transition-colors",
              brand === b.key
                ? "bg-pulse-surface-2 text-pulse-text"
                : "text-pulse-text-dim hover:text-pulse-text",
            )}
          >
            {b.label}
          </Link>
        ))}
      </div>
      <p className="-mt-3 max-w-2xl text-xs text-pulse-text-mute">{current.blurb}</p>

      <CrmHealth
        metrics={metrics}
        settings={settings}
        dueTasks={dueTasks}
        activity={activity}
      />
      <PipelineView brand={brand} lists={lists} rows={rows} />
    </div>
  );
}
