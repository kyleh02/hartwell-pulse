import { PageHeader } from "@/components/ui/PageHeader";
import { createServerSupabase } from "@/lib/supabase/server";
import type { BoardCard, Client } from "@/lib/types/database";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const metadata = { title: "Admin" };

export default async function AdminDashboardPage() {
  const supabase = await createServerSupabase();
  const [{ data: cardData }, { data: clientData }] = await Promise.all([
    supabase.from("board_cards").select("*").order("position", { ascending: true }),
    supabase.from("clients").select("id, business_name").order("business_name"),
  ]);

  const cards = (cardData as BoardCard[] | null) ?? [];
  const clients = (clientData as Pick<Client, "id" | "business_name">[] | null) ?? [];

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div>
      <PageHeader
        label={["Command", "Overview"]}
        title="Dashboard"
        description="Plan the month and run the day. Switch between the calendar and the board to see all client work in one place."
      />
      <AdminDashboard initialCards={cards} clients={clients} today={today} />
    </div>
  );
}
