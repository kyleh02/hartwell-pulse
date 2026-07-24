import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Conversation } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  ClientMessages,
  type ClientConversationRow,
} from "@/components/messages/ClientMessages";

export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  // RLS returns only the threads this user is a member of — a teammate's
  // private thread with Kyle never appears here.
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("conversations")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const conversations: ClientConversationRow[] = (
    (data as Conversation[] | null) ?? []
  ).map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.kind === "group" ? (c.title ?? "Team chat") : "Kyle",
  }));

  return (
    <div>
      <PageHeader
        label={["Messages"]}
        title="Messages with Kyle"
        description="A direct line to Kyle. Ask a question, share a file, or just check in."
      />
      <ClientMessages
        conversations={conversations}
        clientId={session.clientId}
      />
    </div>
  );
}
