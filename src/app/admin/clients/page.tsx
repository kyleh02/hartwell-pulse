import Link from "next/link";
import { Users } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Client, ClientStatus } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { NewClientForm } from "@/components/admin/NewClientForm";
import { ClientActions } from "@/components/admin/ClientActions";

export const metadata = { title: "Clients" };

const GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

const STATUS_TONE: Record<ClientStatus, "success" | "warn" | "neutral"> = {
  active: "success",
  onboarding: "warn",
  paused: "neutral",
};

function daysLeft(deletedAt: string): number {
  const ms = new Date(deletedAt).getTime() + GRACE_DAYS * DAY_MS - Date.now();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

type Section = "active" | "inactive" | "deleted";

export default async function AdminClientsPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("clients")
    .select("*")
    .order("business_name");

  // Purged clients are kept only as invoice anchors — never shown here.
  const all = ((data as Client[] | null) ?? []).filter((c) => !c.purged_at);
  const active = all.filter((c) => !c.deleted_at && c.status !== "paused");
  const inactive = all.filter((c) => !c.deleted_at && c.status === "paused");
  const deleted = all.filter((c) => c.deleted_at);

  return (
    <div className="space-y-8">
      <PageHeader
        label={["Clients"]}
        title="Clients"
        description="Active clients, parked (inactive) clients, and a 30-day recovery bin. Your invoices are never affected by any of this."
        actions={<NewClientForm />}
      />

      {all.length === 0 ? (
        <EmptyState
          icon={<Users size={20} strokeWidth={1.75} />}
          title="No clients yet"
          description="Add your first client and Pulse will create their login and company record in one step."
        />
      ) : (
        <>
          <ClientSection title="Active" count={active.length}>
            {active.length === 0 ? (
              <p className="text-sm text-pulse-text-dim">No active clients.</p>
            ) : (
              <Grid>
                {active.map((c) => (
                  <ClientCard key={c.id} client={c} section="active" />
                ))}
              </Grid>
            )}
          </ClientSection>

          {inactive.length > 0 && (
            <ClientSection
              title="Inactive"
              count={inactive.length}
              hint="Kept indefinitely — reactivate any time."
            >
              <Grid>
                {inactive.map((c) => (
                  <ClientCard key={c.id} client={c} section="inactive" />
                ))}
              </Grid>
            </ClientSection>
          )}

          {deleted.length > 0 && (
            <ClientSection
              title="Recently deleted"
              count={deleted.length}
              hint="Restorable until the countdown ends, then portal data is purged — invoices kept."
            >
              <Grid>
                {deleted.map((c) => (
                  <ClientCard key={c.id} client={c} section="deleted" />
                ))}
              </Grid>
            </ClientSection>
          )}
        </>
      )}
    </div>
  );
}

function ClientSection({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-medium text-pulse-text">{title}</h2>
        <span className="data-mono text-xs text-pulse-text-mute">{count}</span>
        {hint && <span className="text-xs text-pulse-text-mute">· {hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

function ClientCard({ client: c, section }: { client: Client; section: Section }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-pulse-text">
          {c.business_name}
        </span>
        {section === "deleted" ? (
          <Badge tone="danger">{daysLeft(c.deleted_at as string)}d left</Badge>
        ) : section === "inactive" ? (
          <Badge tone="neutral">inactive</Badge>
        ) : (
          <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
        )}
      </div>
      <p className="data-mono mt-1 text-xs text-pulse-text-mute">{c.service_tier}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {section !== "deleted" && (
          <Link
            href={`/admin/clients/${c.id}/preview`}
            className={buttonClasses("secondary", "sm")}
          >
            Preview
          </Link>
        )}
        <ClientActions
          clientId={c.id}
          clientName={c.business_name}
          section={section}
        />
      </div>
    </Card>
  );
}
