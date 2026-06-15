import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { Shell } from "@/components/nav/Shell";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getPulseSession();
  if (!session) redirect("/sign-in");
  if (session.role === "admin") redirect("/admin");
  if (session.role !== "client" || !session.clientId) redirect("/");

  // RLS makes sure this only ever returns the signed-in client's own row.
  const supabase = await createServerSupabase();
  const { data: client } = await supabase
    .from("clients")
    .select("business_name, logo_url")
    .eq("id", session.clientId)
    .maybeSingle();

  const name =
    session.profile?.full_name ?? session.profile?.email ?? "Client";

  return (
    <Shell
      variant="client"
      user={{ name, email: session.profile?.email ?? null }}
      clientName={client?.business_name ?? null}
      clientLogoUrl={client?.logo_url ?? null}
    >
      {children}
    </Shell>
  );
}
