import Link from "next/link";
import { Plus } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { listApprovals } from "@/lib/approvals";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import { ApprovalBoard } from "@/components/approvals/ApprovalBoard";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Approvals" };

export default async function AdminApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const supabase = await createServerSupabase();
  const [{ rows, missing }, { data: clientData }] = await Promise.all([
    listApprovals(supabase, { clientId: client ?? null }),
    supabase.from("clients").select("id, business_name").is("deleted_at", null).order("business_name"),
  ]);
  const clients = (clientData as { id: string; business_name: string }[] | null) ?? [];

  return (
    <div>
      <PageHeader
        label={["Approvals"]}
        title="Content approvals"
        description="Copy, designs, social posts and ads waiting for a client's OK, sent back for changes, or signed off."
        actions={
          <Link href={`/admin/approvals/new${client ? `?client=${client}` : ""}`} className={buttonClasses("primary", "md")}>
            <Plus size={15} aria-hidden="true" /> New
          </Link>
        }
      />

      {missing ? (
        <p className="rounded-[16px] border border-pulse-warn/40 bg-pulse-warn/10 px-4 py-3 text-sm text-pulse-text">
          Run migration 0054 in the Supabase SQL Editor to switch the approval board on.
        </p>
      ) : (
        <>
          <nav aria-label="Filter by client" className="mb-6 flex flex-wrap gap-2">
            <FilterLink href="/admin/approvals" on={!client}>
              All clients
            </FilterLink>
            {clients.map((c) => (
              <FilterLink key={c.id} href={`/admin/approvals?client=${c.id}`} on={client === c.id}>
                {c.business_name}
              </FilterLink>
            ))}
          </nav>
          <ApprovalBoard rows={rows} role="admin" hrefBase="/admin/approvals" />
        </>
      )}
    </div>
  );
}

function FilterLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        on
          ? "border-pulse-gold/50 bg-pulse-gold/10 text-pulse-text"
          : "border-pulse-border text-pulse-text-dim hover:border-pulse-border-strong hover:text-pulse-text",
      )}
    >
      {children}
    </Link>
  );
}
