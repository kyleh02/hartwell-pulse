import { createServerSupabase } from "@/lib/supabase/server";
import type { Client } from "@/lib/types/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminMessages } from "@/components/messages/AdminMessages";

export const metadata = { title: "Messages" };

export default async function AdminMessagesPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("clients")
    .select("id, business_name")
    .order("business_name");
  const clients = (data as Pick<Client, "id" | "business_name">[] | null) ?? [];

  return (
    <div>
      <PageHeader
        label={["Messages", "All Clients"]}
        title="Messages"
        description="Every client conversation in one place. Reply to anyone, share files, and react."
      />
      <AdminMessages clients={clients} />
    </div>
  );
}
