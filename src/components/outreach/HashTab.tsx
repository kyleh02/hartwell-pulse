"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Notifications sent before the tabs (Stage 8) link to /admin/outreach#replies.
 * Send those to the Replies tab.
 */
export function HashTab() {
  const router = useRouter();
  useEffect(() => {
    if (window.location.hash === "#replies") router.replace("/admin/outreach?tab=replies", { scroll: false });
  }, [router]);
  return null;
}
