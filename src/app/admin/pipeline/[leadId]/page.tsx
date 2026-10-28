import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getLead } from "@/lib/pipeline";
import { businessToday } from "@/lib/business-time";
import { SOURCE_LABEL, STAGE_LABEL, leadTitle } from "@/lib/pipeline-shared";
import { LeadEditor } from "@/components/pipeline/LeadEditor";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const supabase = await createServerSupabase();
  const found = await getLead(supabase, leadId);
  if (!found) notFound();
  const { lead } = found;

  return (
    <div className="max-w-6xl">
      <Link href="/admin/pipeline" className="mb-5 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim hover:text-pulse-text">
        <ArrowLeft size={15} aria-hidden="true" /> Pipeline
      </Link>
      <h1 className="text-[26px] leading-[1.05] font-extrabold tracking-[-0.01em] break-words text-pulse-text uppercase sm:text-[34px]">
        {leadTitle(lead)}
      </h1>
      <p className="mt-2 text-sm text-pulse-text-dim">
        {[lead.business && lead.name ? lead.name : null, STAGE_LABEL[lead.stage], SOURCE_LABEL[lead.source]].filter(Boolean).join(" · ")}
      </p>
      <div className="gold-rule mt-5 mb-7" aria-hidden="true" />
      <LeadEditor lead={lead} activity={found.activity} doNotContact={found.doNotContact} today={businessToday()} />
    </div>
  );
}
