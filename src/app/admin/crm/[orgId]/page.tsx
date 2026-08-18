import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCrmMetrics, getCrmSettings, getProspect } from "@/lib/crm";
import { ProspectDetail } from "@/components/crm/ProspectDetail";
import { OutreachComposer } from "@/components/crm/OutreachComposer";
import { unresolvedSendAt } from "@/lib/crm-unresolved";

export const metadata = { title: "Prospect" };

export default async function CrmProspectPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const supabase = await createServerSupabase();
  const detail = await getProspect(supabase, orgId);
  if (!detail) notFound();

  // Passed through so a logged send knows whether it just completed the day.
  const [metrics, settings] = await Promise.all([
    getCrmMetrics(supabase, 7, detail.organisation.brand),
    getCrmSettings(supabase),
  ]);

  return (
    <div>
      <Link
        href="/admin/crm"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ChevronLeft size={15} /> Pipeline
      </Link>
      {/* The email that will go out, and the approval that lets it. Only for
          Ironpeak: the Hartwell pipeline has no automated sending.

          unresolvedSendAt is asked here because approval is the last point a
          person looks before an email goes. Nothing wrote back to the handoff
          after 11 August and the mailbox cannot be opened, so a record
          scheduled that week may already be sitting in their inbox. */}
      {detail.organisation.brand === "ironpeak" && (
        <div className="mb-4">
          <OutreachComposer
            organisationId={detail.organisation.id}
            initialSubject={detail.organisation.email_subject}
            initialBody={detail.organisation.email_body}
            scheduledSendAt={detail.organisation.scheduled_send_at}
            approvedAt={detail.organisation.send_approved_at}
            sendError={detail.organisation.send_error}
            hardWarning={detail.organisation.hard_warning}
            unresolvedSendAt={unresolvedSendAt(
              detail.organisation.legal_name,
              detail.touches,
            )}
            recipient={detail.contact?.email_as_published ?? null}
          />
        </div>
      )}

      <ProspectDetail
        detail={detail}
        goalDone={metrics.sent_today}
        goalTarget={settings?.daily_contact_goal ?? 0}
      />
    </div>
  );
}
