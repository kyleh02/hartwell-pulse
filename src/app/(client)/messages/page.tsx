import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { ChatThread } from "@/components/messages/ChatThread";

export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  return (
    <div>
      <PageHeader
        label={["Messages"]}
        title="Messages with Kyle"
        description="A direct line to Kyle. Ask a question, share a file, or just check in."
      />
      <ChatThread clientId={session.clientId} role="client" peerName="Kyle" />
    </div>
  );
}
