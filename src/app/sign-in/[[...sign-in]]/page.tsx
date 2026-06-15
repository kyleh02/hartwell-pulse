import { SignIn } from "@clerk/nextjs";
import { Wordmark } from "@/components/brand/Wordmark";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-pulse-bg bg-grid px-6 py-12">
      <div className="pointer-events-none absolute inset-0 bg-vignette" />
      <div className="pointer-events-none absolute inset-0 bg-scanline opacity-70" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Wordmark size="lg" />
          <p className="mono-label mt-4">Client Portal</p>
          <p className="mt-3 max-w-xs text-sm text-pulse-text-dim">
            Check the pulse of your marketing. Sign in to pick up where you left
            off.
          </p>
        </div>
        <div className="flex justify-center">
          <SignIn />
        </div>
      </div>
    </main>
  );
}
