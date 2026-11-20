"use client";

import { useMemo, useState } from "react";
import { describe, lintSlots, SLOTS, type SlotName } from "@/lib/outreach/lint";
import { TOKEN_GUIDE } from "@/lib/outreach/tokens";

const field =
  "w-full rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-sm text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";

// What the tokens look like filled, for the length and punctuation checks.
const SAMPLE: Record<string, string> = {
  day: "Tuesday",
  first_paint: "a little over six seconds",
  largest_paint: "a little over seven seconds",
  page: "canopy",
  broken_page: "contact",
  area: "Sunshine Coast",
  pageviews: "twice",
};

const LABEL: Record<SlotName, string> = {
  finding: "{finding}",
  why_and_fix: "{why_and_fix}",
  second_finding: "{second_finding} (the follow-up)",
};

/**
 * Try wording against the lint, as Claude's drafts will be. Runs in the
 * browser, nothing is saved. The figures, page names and places in a real
 * draft are checked against Pulse's records at submit; here the tokens are
 * filled with sample values.
 */
export function WordingCheck() {
  const [slots, setSlots] = useState<Record<SlotName, string>>({
    finding:
      "We were looking at 4WD fit-out shops around the [[area]] on [[day]] and had a look at your site. On a phone, your [[page]] page took [[first_paint]] to show anything on Google's own speed test.",
    why_and_fix:
      "Your site has Google's ad tracking on it, so some of those visits are probably paid clicks. Plenty of people on a phone won't wait that long, so it'd be worth getting that page loading faster before putting more into ads.",
    second_finding: "Your [[broken_page]] page, in your main menu, showed an error page when we checked it.",
  });
  const issues = useMemo(() => {
    const filled = Object.fromEntries(
      SLOTS.map((s) => [s, slots[s].replace(/\[\[\s*([a-z_]+)\s*\]\]/g, (w, t: string) => SAMPLE[t] ?? w)]),
    ) as Record<SlotName, string>;
    return describe(lintSlots(slots, filled));
  }, [slots]);

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-2">
        {SLOTS.map((s) => (
          <label key={s} className="block">
            <span className="text-[11px] text-pulse-text-mute">{LABEL[s]}</span>
            <textarea
              className={`${field} mt-0.5 min-h-[4.5rem] resize-y`}
              value={slots[s]}
              onChange={(e) => setSlots({ ...slots, [s]: e.target.value })}
            />
          </label>
        ))}
        {issues.length === 0 ? (
          <p className="text-[13px] text-pulse-success">Passes the wording rules.</p>
        ) : (
          <ul className="space-y-0.5 text-[13px] text-pulse-danger">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
      </div>
      <pre className="font-sans text-[12px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text-mute">{TOKEN_GUIDE}</pre>
    </div>
  );
}
