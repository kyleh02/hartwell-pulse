import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getApproval } from "@/lib/approvals";
import { ApprovalEditor } from "@/components/approvals/ApprovalEditor";
import { ApprovalContent } from "@/components/approvals/ApprovalContent";
import { ApprovalHistory } from "@/components/approvals/ApprovalHistory";
import { ApprovalComment } from "@/components/approvals/ApprovalActions";
import { KindChip, StatusPill } from "@/components/approvals/ApprovalBits";

export const metadata = { title: "Approval" };

export default async function AdminApprovalPage({ params }: { params: Promise<{ approvalId: string }> }) {
  const { approvalId } = await params;
  const supabase = await createServerSupabase();
  const detail = await getApproval(supabase, approvalId);
  if (!detail) notFound();
  const { approval, files, events } = detail;

  return (
    <div>
      <Link
        href={`/admin/approvals?client=${approval.client_id}`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim hover:text-pulse-text"
      >
        <ArrowLeft size={15} aria-hidden="true" /> {approval.clientName ?? "Approvals"}
      </Link>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <KindChip kind={approval.kind} channel={approval.channel} />
        <StatusPill status={approval.status} role="admin" />
        {approval.round > 1 && <span className="text-xs text-pulse-text-mute">Version {approval.round}</span>}
      </div>
      <h1 className="text-[26px] leading-[1.05] font-extrabold tracking-[-0.01em] break-words text-pulse-text uppercase sm:text-[34px]">
        {approval.title}
      </h1>
      <div className="gold-rule mt-5 mb-7" aria-hidden="true" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ApprovalEditor mode="edit" approval={approval} files={files} />
        <div className="space-y-5">
          <section>
            <h2 className="eyebrow mb-3">What the client sees</h2>
            <ApprovalContent approval={approval} files={files} />
          </section>
          <section className="rounded-[16px] border border-pulse-border bg-pulse-surface p-5">
            <h2 className="eyebrow mb-4">History</h2>
            <ApprovalHistory events={events} />
            <div className="mt-5 border-t border-pulse-border pt-4">
              <ApprovalComment id={approval.id} role="admin" />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
