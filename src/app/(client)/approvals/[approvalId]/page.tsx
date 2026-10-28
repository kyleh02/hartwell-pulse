import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getApproval } from "@/lib/approvals";
import { dueLabel } from "@/lib/approvals-shared";
import { ApprovalContent } from "@/components/approvals/ApprovalContent";
import { ApprovalHistory } from "@/components/approvals/ApprovalHistory";
import { ApprovalComment, ApprovalDecision } from "@/components/approvals/ApprovalActions";
import { KindChip, StatusPill } from "@/components/approvals/ApprovalBits";

export const metadata = { title: "Approval" };

export default async function ApprovalPage({ params }: { params: Promise<{ approvalId: string }> }) {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");
  const { approvalId } = await params;

  // Read as the client: RLS returns only their own, sent work.
  const supabase = await createServerSupabase();
  const detail = await getApproval(supabase, approvalId);
  if (!detail || detail.approval.client_id !== session.clientId) notFound();
  const { approval, files, events } = detail;
  const due = dueLabel(approval.due_on);

  return (
    <div>
      <Link href="/approvals" className="mb-5 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim hover:text-pulse-text">
        <ArrowLeft size={15} aria-hidden="true" /> All approvals
      </Link>

      <h1 className="text-[26px] leading-[1.05] font-extrabold tracking-[-0.01em] break-words text-pulse-text uppercase sm:text-[34px]">
        {approval.title}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <KindChip kind={approval.kind} channel={approval.channel} />
        <StatusPill status={approval.status} role="client" />
        {approval.round > 1 && <span className="text-xs text-pulse-text-mute">Version {approval.round}</span>}
        {due && approval.status === "waiting" && (
          <span className="inline-flex items-center gap-1 text-xs text-pulse-text-mute">
            <CalendarClock size={12} aria-hidden="true" /> Please approve by {due}
          </span>
        )}
      </div>
      <div className="gold-rule mt-5 mb-7" aria-hidden="true" />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ApprovalContent approval={approval} files={files} />
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <ApprovalDecision id={approval.id} status={approval.status} />
          <section className="rounded-[16px] border border-pulse-border bg-pulse-surface p-5">
            <h2 className="card-title mb-4">History</h2>
            <ApprovalHistory events={events} />
            <div className="mt-5 border-t border-pulse-border pt-4">
              <ApprovalComment id={approval.id} role="client" />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
