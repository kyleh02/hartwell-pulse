import Link from "next/link";
import { Users } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Client, ClientStatus } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";

export const metadata = { title: "Clients" };

const STATUS_TONE: Record<ClientStatus, "success" | "warn" | "neutral"> = {
  active: "success",
  onboarding: "warn",
  paused: "neutral",
};

export default async function AdminClientsPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("clients")
    .select("*")
    .order("business_name");
  const clients = (data as Client[] | null) ?? [];

  return (
    <div>
      <PageHeader
        label={["Clients"]}
        title="Clients"
        description="Every client at a glance. Open a preview to see exactly what they see on their dashboard."
        actions={<Button disabled>Add client</Button>}
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={<Users size={20} strokeWidth={1.75} />}
          title="No clients yet"
          description="Run the demo seed in Supabase to add Demo Co, or full client setup is coming in the clients phase."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-pulse-text">
                  {c.business_name}
                </span>
                <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              </div>
              <p className="data-mono mt-1 text-xs text-pulse-text-mute">
                {c.service_tier}
              </p>
              <div className="mt-4">
                <Link
                  href={`/admin/clients/${c.id}/preview`}
                  className={buttonClasses("secondary", "sm")}
                >
                  Preview dashboard
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
