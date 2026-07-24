import { createServerSupabase } from "@/lib/supabase/server";
import type { Client, ClientUser, Conversation } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminMessages } from "@/components/messages/AdminMessages";

export const metadata = { title: "Messages" };

export default async function AdminMessagesPage() {
  const supabase = await createServerSupabase();
  const [{ data: convData }, { data: clientData }, { data: userData }] =
    await Promise.all([
      supabase.from("conversations").select("*"),
      supabase
        .from("clients")
        .select("id, business_name, deleted_at, purged_at")
        .order("business_name"),
      supabase
        .from("client_users")
        .select("clerk_user_id, client_id, full_name")
        .eq("role", "client")
        .order("created_at"),
    ]);

  const conversations = (convData as Conversation[] | null) ?? [];
  const clients = (
    (clientData as Pick<
      Client,
      "id" | "business_name" | "deleted_at" | "purged_at"
    >[] | null) ?? []
  ).filter((c) => !c.deleted_at && !c.purged_at);
  const names = new Map(clients.map((c) => [c.id, c.business_name]));
  const users = (
    (userData as Pick<
      ClientUser,
      "clerk_user_id" | "client_id" | "full_name"
    >[] | null) ?? []
  ).filter((u) => u.client_id && names.has(u.client_id));
  const userNames = new Map(
    users.map((u) => [u.clerk_user_id, u.full_name ?? "Unnamed user"]),
  );

  // Only conversations whose client still exists in the portal.
  const rows = conversations
    .filter((cv) => names.has(cv.client_id))
    .map((cv) => ({
      id: cv.id,
      client_id: cv.client_id,
      client_name: names.get(cv.client_id) as string,
      kind: cv.kind,
      title: cv.title,
      direct_user_name:
        cv.kind === "direct" && cv.direct_user_id
          ? (userNames.get(cv.direct_user_id) ?? null)
          : null,
      deleted_at: cv.deleted_at,
    }))
    .sort(
      (a, b) =>
        a.client_name.localeCompare(b.client_name) ||
        a.kind.localeCompare(b.kind),
    );

  // Users you could start a direct thread with (none active right now — a
  // soft-deleted one revives on start).
  const activeDirectUsers = new Set(
    conversations
      .filter((cv) => cv.kind === "direct" && !cv.deleted_at)
      .map((cv) => cv.direct_user_id),
  );
  const startableDirects = users
    .filter((u) => !activeDirectUsers.has(u.clerk_user_id))
    .map((u) => ({
      client_id: u.client_id as string,
      client_name: names.get(u.client_id as string) as string,
      clerk_user_id: u.clerk_user_id,
      user_name: u.full_name ?? "Unnamed user",
    }));

  // Clients with 2+ users can hold a group chat.
  const byClient = new Map<string, { clerk_user_id: string; name: string }[]>();
  for (const u of users) {
    const list = byClient.get(u.client_id as string) ?? [];
    list.push({
      clerk_user_id: u.clerk_user_id,
      name: u.full_name ?? "Unnamed user",
    });
    byClient.set(u.client_id as string, list);
  }
  const groupableClients = clients
    .filter((c) => (byClient.get(c.id)?.length ?? 0) >= 2)
    .map((c) => ({
      id: c.id,
      business_name: c.business_name,
      users: byClient.get(c.id) as { clerk_user_id: string; name: string }[],
    }));

  return (
    <div>
      <PageHeader
        label={["Messages", "All Clients"]}
        title="Messages"
        description="Your client conversations: a private thread per person, plus group chats. Start one deliberately, reply, share files — or delete a thread (restorable for 30 days)."
      />
      <AdminMessages
        conversations={rows}
        startableDirects={startableDirects}
        groupableClients={groupableClients}
      />
    </div>
  );
}
