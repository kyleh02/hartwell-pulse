import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { ApprovalEditor } from "@/components/approvals/ApprovalEditor";

export const metadata = { title: "New approval" };

export default async function NewApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("clients").select("id, business_name").is("deleted_at", null).order("business_name");
  const clients = (data as { id: string; business_name: string }[] | null) ?? [];

  return (
    <div className="max-w-4xl">
      <Link href="/admin/approvals" className="mb-5 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim hover:text-pulse-text">
        <ArrowLeft size={15} aria-hidden="true" /> Approvals
      </Link>
      <PageHeader
        label={["Approvals", "New"]}
        title="Something to approve"
        description="Saved as a draft the client can't see. Add the files, check the preview, then send it."
      />
      <ApprovalEditor mode="new" clients={clients} clientId={clients.some((c) => c.id === client) ? (client as string) : null} />
    </div>
  );
}
