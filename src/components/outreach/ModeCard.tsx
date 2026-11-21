"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMode, setPaused, type DraperMode } from "@/app/admin/outreach/sender-actions";
import { Segmented, Switch } from "@/components/outreach/ui";
import { cn } from "@/lib/utils/cn";

const WHAT: Record<DraperMode, string> = {
  off: "Nothing sends. Drafts are still checked and replies still read.",
  test: "Everything goes to your test inboxes, never to a business.",
  live: "Draper emails businesses, inside your window and limits.",
};

/**
 * The one control that matters most: Off, Test or Live, saved the moment
 * it's tapped (Live asks first), and Pause all underneath. Replaces the
 * master switch and test mode checkboxes, which Kyle found hard to read.
 */
export function ModeCard({
  mode,
  paused,
  pausedReason,
  testInboxes,
}: {
  mode: DraperMode;
  paused: boolean;
  pausedReason: string | null;
  testInboxes: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const choose = (next: DraperMode) => {
    if (next === mode) return;
    if (
      next === "live" &&
      !window.confirm("Go live? Draper will email real businesses. Anything still waiting from test mode is dropped first.")
    )
      return;
    setErr(null);
    start(async () => {
      const r = await setMode(next);
      if (!r.ok) setErr(r.message);
      router.refresh();
    });
  };

  const pause = (on: boolean) =>
    start(async () => {
      const r = await setPaused(on);
      if (!r.ok) setErr(r.message);
      router.refresh();
    });

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
      <div className="space-y-3 p-4">
        <Segmented<DraperMode>
          ariaLabel="Draper's mode"
          tone="mode"
          value={mode}
          disabled={pending}
          onSelect={choose}
          options={[
            { value: "off", label: "Off" },
            { value: "test", label: "Test" },
            { value: "live", label: "Live" },
          ]}
        />
        <p className="text-[13px] leading-relaxed text-pulse-text-dim">
          {WHAT[mode]}
          {mode === "test" && testInboxes.length > 0 && <span className="text-pulse-text-mute"> ({testInboxes.join(", ")})</span>}
        </p>
        {err && <p className="text-[13px] text-pulse-danger">{err}</p>}
      </div>
      <div className={cn("flex items-center justify-between gap-3 border-t border-pulse-border px-4 py-3.5", paused && "bg-pulse-warn/10")}>
        <div className="min-w-0">
          <p className="text-[15px] text-pulse-text">Pause all</p>
          <p className={cn("mt-0.5 text-[12px] leading-snug", paused ? "text-pulse-warn" : "text-pulse-text-mute")}>
            {paused ? pausedReason ?? "Everything is held." : "Holds every email until you switch it back."}
          </p>
        </div>
        <Switch label="Pause all" on={paused} disabled={pending} onChange={pause} />
      </div>
    </div>
  );
}
