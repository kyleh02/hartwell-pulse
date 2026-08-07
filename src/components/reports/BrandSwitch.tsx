"use client";

import type { Brand } from "@/lib/types/database";
import { Wordmark } from "@/components/brand/Wordmark";
import { IronpeakMark } from "@/components/brand/IronpeakMark";
import { cn } from "@/lib/utils/cn";

/**
 * Which letterhead this report wears.
 *
 * A segmented control rather than a dropdown, because the choice is between
 * two known things and the whole point is to see which one is active at a
 * glance. Each option carries its own mark, so it reads as picking a brand
 * rather than setting a field.
 */
export function BrandSwitch({
  value,
  onChange,
  disabled,
}: {
  value: Brand;
  onChange: (brand: Brand) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="mono-label">Letterhead</span>
      <div
        role="group"
        aria-label="Report letterhead"
        className="inline-flex overflow-hidden rounded-[var(--radius-input)] border border-pulse-border"
      >
        <BrandOption
          active={value === "hartwell"}
          disabled={disabled}
          onClick={() => onChange("hartwell")}
        >
          <Wordmark size="sm" />
        </BrandOption>
        <BrandOption
          active={value === "ironpeak"}
          disabled={disabled}
          onClick={() => onChange("ironpeak")}
        >
          <IronpeakMark size={13} className="shrink-0" />
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.14em]">
            Ironpeak
          </span>
        </BrandOption>
      </div>
    </div>
  );
}

function BrandOption({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors disabled:opacity-50",
        active
          ? "bg-pulse-surface-2 text-pulse-text"
          : "text-pulse-text-mute hover:text-pulse-text-dim",
      )}
    >
      {children}
    </button>
  );
}
