import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  Recurrences,
  type RecurrenceListRow,
} from "@/components/work/Recurrences";
import type { Client } from "@/lib/types/database";

export const metadata = { title: "Recurring work" };
export const dynamic = "force-dynamic";

export default async function RecurringWorkPage() {
  const supabase = await createServerSupabase();
  const [{ data: recData }, { data: clientData }] = await Promise.all([
    supabase
      .from("work_item_recurrences")
      .select("*, clients(business_name)")
      .order("created_at"),
    supabase.from("clients").select("id, business_name").order("business_name"),
  ]);

  const rows: RecurrenceListRow[] = (
    (recData as
      | (Omit<RecurrenceListRow, "client_name"> & {
          clients: { business_name: string } | { business_name: string }[] | null;
        })[]
      | null) ?? []
  ).map((r) => {
    const client = Array.isArray(r.clients) ? r.clients[0] : r.clients;
    return {
      ...r,
      client_name: client?.business_name ?? null,
      steps: Array.isArray(r.steps) ? r.steps : [],
    };
  });

  const clients =
    (clientData as Pick<Client, "id" | "business_name">[] | null) ?? [];

  return (
    <div>
      <Link
        href="/admin"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-pulse-text-dim transition-colors hover:text-pulse-text"
      >
        <ArrowLeft size={15} strokeWidth={1.75} />
        Dashboard
      </Link>
      <PageHeader
        label={["Command", "Recurring"]}
        title="Recurring work"
        description="The jobs that come back. Each drops a fresh item on the list when its lead time arrives."
      />
      <Recurrences rows={rows} clients={clients} />
    </div>
  );
}
