import Link from "next/link";
import { PenLine, Users } from "lucide-react";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Client, CopyDocument } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewCopyButton } from "@/components/copy/NewCopyButton";
import { CopyDocList } from "@/components/copy/CopyDocList";

export const metadata = { title: "Client copy" };

export default async function AdminCopyPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const session = await getPulseSession();
  const supabase = await createServerSupabase();
  const { client: clientId } = await searchParams;

  const { data: clientData } = await supabase
    .from("clients")
    .select("id, business_name")
    .order("business_name");
  const clients = (clientData as Pick<Client, "id" | "business_name">[] | null) ?? [];

  if (!clientId) {
    return (
      <div>
        <PageHeader
          label={["Copy", "All Clients"]}
          title="Client copy"
          description="Pick a client to review the copy they've drafted. Approve it, or request changes with a note."
        />
        {clients.length === 0 ? (
          <EmptyState
            icon={<Users size={20} strokeWidth={1.75} />}
            title="No clients yet"
            description="Add a client and their copy documents will appear here."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {clients.map((c) => (
              <Link
                key={c.id}
                href={`/admin/copy?client=${c.id}`}
                className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4 transition-colors hover:border-pulse-border-strong"
              >
                <PenLine size={18} className="shrink-0 text-pulse-gold" />
                <span className="truncate text-sm text-pulse-text">
                  {c.business_name}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const { data } = await supabase
    .from("copy_documents")
    .select("*")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });
  const docs = (data as CopyDocument[] | null) ?? [];
  const name = clients.find((c) => c.id === clientId)?.business_name;

  return (
    <div>
      <PageHeader
        label={["Copy", name ?? "Client"]}
        title="Client copy"
        description="Review drafted copy, approve it, or request changes. You can also draft on the client's behalf."
      />
      <div className="mb-5">
        <NewCopyButton
          clientId={clientId}
          basePath="/admin/copy"
          currentUserId={session?.clerkUserId ?? ""}
        />
      </div>
      {docs.length === 0 ? (
        <EmptyState
          icon={<PenLine size={20} strokeWidth={1.75} />}
          title="No documents yet"
          description="This client hasn't drafted any copy yet."
        />
      ) : (
        <CopyDocList docs={docs} basePath="/admin/copy" />
      )}
    </div>
  );
}
