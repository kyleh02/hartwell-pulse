import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { Shell } from "@/components/nav/Shell";
import { Wordmark } from "@/components/brand/Wordmark";

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
    .select("business_name, logo_url, deleted_at")
    .eq("id", session.clientId)
    .maybeSingle();

  // A soft-deleted client keeps their data (recoverable for 30 days) but loses
  // portal access right away.
  if ((client as { deleted_at: string | null } | null)?.deleted_at) {
    return (
      <main className="relative flex min-h-screen flex-col items-center justify-center bg-pulse-bg bg-grid px-6 text-center">
        <div className="relative">
          <Wordmark size="lg" />
          <h1 className="mt-8 text-xl font-medium text-pulse-text">
            Your portal access has ended
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-pulse-text-dim">
            This account is no longer active. If you think this is a mistake,
            please get in touch with Kyle.
          </p>
        </div>
      </main>
    );
  }

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
