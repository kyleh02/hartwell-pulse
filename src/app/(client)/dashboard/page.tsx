import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { getClientHome } from "@/lib/client-home";
import { ClientHome } from "@/components/home/ClientHome";
import { SetPasswordCard } from "@/components/home/SetPasswordCard";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const session = await getPulseSession();
  if (!session?.clientId) redirect("/");

  const supabase = await createServerSupabase();
  const data = await getClientHome(supabase, session.clientId, {
    firstName: session.profile?.full_name,
  });
  if (!data) redirect("/");

  return (
    <>
      <SetPasswordCard />
      <ClientHome data={data} />
    </>
  );
}
