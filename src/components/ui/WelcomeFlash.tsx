"use client";

import { useEffect, useState } from "react";
import { Wordmark } from "@/components/brand/Wordmark";
import { cn } from "@/lib/utils/cn";

/**
 * A brief hello when someone arrives.
 *
 * Once per browser session, not once per page. sessionStorage is the right
 * store for that: it survives client-side navigation and a refresh, so moving
 * between Reports and Invoices does not greet you again, but it is empty in a
 * fresh tab and after signing back in, which is exactly when a welcome is
 * warranted.
 *
 * It never takes the pointer. A greeting that swallows the first click of the
 * session would be worse than no greeting at all, so the whole thing is
 * pointer-events-none and simply times out.
 */
const SEEN_KEY = "pulse-welcomed";
const VISIBLE_MS = 2600;

function greeting(): string {
  // The portal thinks in Brisbane time everywhere else, so it should here too.
  const hour = Number(
    new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      hour12: false,
      timeZone: "Australia/Brisbane",
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function WelcomeFlash({ name }: { name: string }) {
  const [phase, setPhase] = useState<"hidden" | "in" | "out">("hidden");

  useEffect(() => {
    let seen = true;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
      if (!seen) sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Private browsing with storage disabled: skip rather than greet on
      // every single page load, which would be maddening.
      return;
    }
    if (seen) return;

    setPhase("in");
    const outAt = setTimeout(() => setPhase("out"), VISIBLE_MS);
    const goneAt = setTimeout(() => setPhase("hidden"), VISIBLE_MS + 420);
    return () => {
      clearTimeout(outAt);
      clearTimeout(goneAt);
    };
  }, []);

  if (phase === "hidden") return null;

  const first = name.trim().split(/\s+/)[0] || null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-6"
    >
      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface/90 px-8 py-7 text-center shadow-2xl backdrop-blur",
          "transition-all duration-[420ms] ease-out motion-reduce:transition-none",
          phase === "in"
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-1 scale-[0.98] opacity-0",
        )}
      >
        <Wordmark size="md" />
        <p className="text-lg font-medium text-pulse-text">
          {greeting()}
          {first ? `, ${first}` : ""}
        </p>
      </div>
    </div>
  );
}
