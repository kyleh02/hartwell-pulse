import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { SendPlan, type PlanRow } from "@/components/crm/SendPlan";

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
      "id, legal_name, trading_name, state, domain, rank, priority_tier, channel, stage, scheduled_send_at, scheduled_at, followup_due, hook, hook_verified_at, hard_warning, crm_contacts(first_name, surname, role_title, email_as_published, name_verified, fallback_greeting)",
    )
    .eq("brand", "ironpeak")
    .order("rank");

  const rows = ((data as PlanRow[] | null) ?? []).map((r) => ({
    ...r,
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
        description="The pipeline in the order it gets worked. Mark each one drafted when it is sitting in Outlook, then logged when it has actually gone."
      />

      <SendPlan rows={rows} />
    </div>
  );
}
