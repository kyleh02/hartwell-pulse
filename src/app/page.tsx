import { redirect } from "next/navigation";
import { getPulseSession } from "@/lib/auth/session";
import { Wordmark } from "@/components/brand/Wordmark";

// Auth is required by middleware, so we always have a Clerk user here. Route
// them to the right home based on their Pulse role.
export default async function RootPage() {
  const session = await getPulseSession();

  if (session?.role === "admin") redirect("/admin");
  if (session?.role === "client") redirect("/dashboard");

  // Signed in with Clerk, but not yet mapped to a Pulse account.
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-pulse-bg bg-grid px-6 text-center">
      <div className="absolute inset-0 bg-vignette" />
      <div className="relative">
        <Wordmark size="lg" />
        <h1 className="mt-8 text-xl font-medium text-pulse-text">
          Your account is being set up
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-pulse-text-dim">
          You are signed in, but Kyle has not finished connecting your account
          yet. Give it a little while, or reach out if you think this is a
          mistake.
        </p>
      </div>
    </main>
  );
}
