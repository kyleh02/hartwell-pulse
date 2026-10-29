"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, useSignIn } from "@clerk/nextjs";
import { LoaderCircle } from "lucide-react";
import { Wordmark } from "@/components/brand/Wordmark";
import { HdMark } from "@/components/brand/HdMark";

/**
 * Where the button in a welcome email lands. It carries a one-time sign-in
 * ticket (made with the client's portal, valid seven days), which is swapped
 * here for a session, and then they are taken to onboarding. No password to
 * send, none to type.
 *
 * Public in middleware, because the whole point is that they are signed out.
 */
function SignInWithTicket() {
  const params = useSearchParams();
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isSignedIn } = useAuth();
  const [failed, setFailed] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    if (!isLoaded || tried.current) return;
    tried.current = true;
    if (isSignedIn) {
      router.replace("/welcome");
      return;
    }
    const ticket = params.get("t");
    if (!ticket) {
      setFailed(true);
      return;
    }
    signIn
      .create({ strategy: "ticket", ticket })
      .then(async (res) => {
        if (res.status === "complete" && res.createdSessionId) {
          await setActive({ session: res.createdSessionId });
          router.replace("/welcome");
        } else {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
  }, [isLoaded, isSignedIn, params, router, signIn, setActive]);

  return failed ? (
    <>
      <h1 className="text-xl font-extrabold text-pulse-text uppercase">This link has expired</h1>
      <p className="mt-3 text-sm leading-relaxed text-pulse-text-dim">
        Sign-in links work once and last seven days. Sign in with your email address instead, or ask Kyle to send a fresh
        link.
      </p>
      <Link
        href="/sign-in"
        className="mt-6 inline-flex h-10 items-center rounded-[2px] bg-pulse-gold px-5 text-xs font-bold tracking-[0.14em] text-pulse-bg uppercase"
      >
        Sign in
      </Link>
    </>
  ) : (
    <>
      <LoaderCircle size={26} className="mx-auto animate-spin text-pulse-gold" aria-hidden="true" />
      <p className="mt-4 text-sm text-pulse-text-dim" role="status">
        Signing you in…
      </p>
    </>
  );
}

export default function WelcomeInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-pulse-bg px-6 text-center">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center">
          <HdMark size={112} className="mb-7" />
          <Wordmark size="lg" withGlyph={false} />
        </div>
        <Suspense fallback={null}>
          <SignInWithTicket />
        </Suspense>
      </div>
    </main>
  );
}
