import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { Shell } from "@/components/nav/Shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getPulseSession();
  if (!session) redirect("/sign-in");
  // The admin area is Kyle only. Anyone else gets bounced to their own home.
  if (session.role !== "admin") redirect("/");

  const name = session.profile?.full_name ?? "Kyle";

  return (
    <Shell
      variant="admin"
      user={{ name, email: session.profile?.email ?? null }}
    >
      {children}
    </Shell>
  );
}
