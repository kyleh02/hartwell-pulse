import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { getProspect } from "@/lib/crm";
import { ProspectDetail } from "@/components/crm/ProspectDetail";

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

  return (
    <div>
      <Link
        href="/admin/crm"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ChevronLeft size={15} /> Pipeline
      </Link>
      <ProspectDetail detail={detail} />
    </div>
  );
}
