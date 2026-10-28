import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { BUSINESS_TZ } from "@/lib/business-time";
import { PageHeader } from "@/components/ui/PageHeader";
import { AddDoNotContact } from "@/components/pipeline/AddDoNotContact";

export const metadata = { title: "Do not contact" };

/**
 * Everyone who has asked not to be contacted. Kept when the old outreach
 * pipeline was deleted, and checked whenever a lead is added, because an
 * opt-out has to be honoured for good, not until the next clear-out.
 */
export default async function DoNotContactPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("do_not_contact")
    .select("id, email, name, business, website, reason, source, recorded_at")
    .order("recorded_at", { ascending: false });
  const rows =
    (data as {
      id: string;
      email: string | null;
      name: string | null;
      business: string | null;
      website: string | null;
      reason: string;
      source: string | null;
      recorded_at: string;
    }[] | null) ?? [];

  return (
    <div className="max-w-4xl">
      <Link href="/admin/pipeline" className="mb-5 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim hover:text-pulse-text">
        <ArrowLeft size={15} aria-hidden="true" /> Pipeline
      </Link>
      <PageHeader
        label={["Pipeline", "Do not contact"]}
        title="Do not contact"
        description="People who opted out or asked not to be contacted. A lead with one of these addresses is flagged, so nobody who said no hears from you again."
      />
      {error ? (
        <p className="text-sm text-pulse-text-dim">Run migration 0056 in the Supabase SQL Editor first.</p>
      ) : (
        <>
          <AddDoNotContact />
          <ul className="mt-6 divide-y divide-pulse-border rounded-[20px] border border-pulse-border bg-pulse-surface">
            {rows.length === 0 && <li className="p-5 text-sm text-pulse-text-mute">Nobody on the list.</li>}
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-pulse-text">{r.business || r.name || r.email || "Unknown"}</p>
                  <p className="truncate text-xs text-pulse-text-dim">{[r.name, r.email, r.website].filter(Boolean).join(" · ")}</p>
                </div>
                <p className="shrink-0 text-xs text-pulse-text-mute">
                  {r.reason}
                  {r.source ? ` · ${r.source}` : ""} ·{" "}
                  {new Date(r.recorded_at).toLocaleDateString("en-AU", { timeZone: BUSINESS_TZ, day: "numeric", month: "short", year: "numeric" })}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
