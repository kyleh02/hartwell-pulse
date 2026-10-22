"use client";

import { useLinkStatus } from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A navigation icon that answers the tap.
 *
 * Feedback at the exact place you pressed, from the moment you press it, which
 * is the part a page-level loading state cannot give: until the next page's
 * placeholder arrives there is otherwise nothing to say the tap registered.
 *
 * useLinkStatus only works from INSIDE a Link, which is why this is its own
 * component rather than a few lines in the nav.
 *
 * The ring fades in after a short delay, so a page that was already prefetched
 * and swaps instantly does not flash a spinner on the way past.
 */
export function NavIcon({ icon: Icon, size }: { icon: LucideIcon; size: number }) {
  const { pending } = useLinkStatus();
  return (
    <span className="relative inline-flex">
      <Icon
        size={size}
        strokeWidth={1.75}
        className={cn(pending && "text-pulse-gold")}
      />
      {pending && <span aria-hidden="true" className="nav-pending-ring" />}
    </span>
  );
}
