import { createServerSupabase } from "@/lib/supabase/server";
import type { Client, Conversation } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminMessages } from "@/components/messages/AdminMessages";

export const metadata = { title: "Messages" };

export default async function AdminMessagesPage() {
  const supabase = await createServerSupabase();
  const [{ data: convData }, { data: clientData }] = await Promise.all([
    supabase.from("conversations").select("*"),
    supabase
      .from("clients")
      .select("id, business_name, deleted_at, purged_at")
      .order("business_name"),
  ]);

  const conversations = (convData as Conversation[] | null) ?? [];
  const clients = (
    (clientData as Pick<
      Client,
      "id" | "business_name" | "deleted_at" | "purged_at"
    >[] | null) ?? []
  ).filter((c) => !c.deleted_at && !c.purged_at);
  const names = new Map(clients.map((c) => [c.id, c.business_name]));

  // Only conversations whose client still exists in the portal.
  const rows = conversations
    .filter((cv) => names.has(cv.client_id))
    .map((cv) => ({
      client_id: cv.client_id,
      client_name: names.get(cv.client_id) as string,
      deleted_at: cv.deleted_at,
    }))
    .sort((a, b) => a.client_name.localeCompare(b.client_name));

  const active = rows.filter((r) => !r.deleted_at);
  const activeIds = new Set(active.map((r) => r.client_id));
  // Clients you could start a conversation with (none active right now).
  const startable = clients
    .filter((c) => !activeIds.has(c.id))
    .map((c) => ({ id: c.id, business_name: c.business_name }));

  return (
    <div>
      <PageHeader
        label={["Messages", "All Clients"]}
        title="Messages"
        description="Your client conversations. Start one deliberately, reply, share files — or delete a thread (restorable for 30 days)."
      />
      <AdminMessages
        conversations={rows}
        startableClients={startable}
      />
    </div>
  );
}
