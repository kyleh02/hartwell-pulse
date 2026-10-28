import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { listApprovals } from "@/lib/approvals";
import { PageHeader } from "@/components/ui/PageHeader";
import { ApprovalBoard } from "@/components/approvals/ApprovalBoard";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  // RLS shows a client only work that has been sent to them.
  const supabase = await createServerSupabase();
  const { rows } = await listApprovals(supabase, { clientId: session.clientId });
  const waiting = rows.filter((r) => r.status === "waiting").length;

  return (
    <div>
      <PageHeader
        label={["Approvals"]}
        title="Work to approve"
        description={
          waiting > 0
            ? `${waiting === 1 ? "One thing is" : `${waiting} things are`} waiting on you. Open it, then approve it or tell Kyle what to change.`
            : "When Kyle has copy, designs, posts or ads ready for your OK, they appear here and you'll get an email."
        }
      />
      <ApprovalBoard rows={rows} role="client" hrefBase="/approvals" />
    </div>
  );
}
