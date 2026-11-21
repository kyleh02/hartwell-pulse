"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Draper's small building blocks (Stage 8, Kyle, 22 Nov 2026: "simple yet
 * aesthetic, Apple like"): a switch, a segmented control, and grouped rows
 * like a phone's settings, in Pulse's own colours and type. Headings stay
 * the portal's `.card-title`; nothing small and spaced-out sits above one.
 */

export function Switch({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse-gold",
        on ? "border-pulse-gold bg-pulse-gold" : "border-pulse-border bg-pulse-surface-2",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-[24px] w-[24px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-200 motion-reduce:transition-none",
          on ? "translate-x-[22px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** For links: where the segment goes. */
  href?: string;
  /** A small count after the label. */
  count?: number;
}

/** A segmented control: buttons (onSelect) or links (href on each option). */
export function Segmented<T extends string>({
  options,
  value,
  onSelect,
  disabled,
  ariaLabel,
  tone = "neutral",
}: {
  options: SegmentOption<T>[];
  value: T;
  onSelect?: (v: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** "live" paints the selected Live segment gold. */
  tone?: "neutral" | "mode";
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex w-full gap-1 rounded-[12px] border border-pulse-border bg-pulse-surface-2 p-1">
      {options.map((o) => {
        const selected = o.value === value;
        const cls = cn(
          "flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2 text-[13px] font-semibold transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pulse-gold",
          selected
            ? tone === "mode" && o.value === "live"
              ? "bg-pulse-gold text-pulse-bg shadow-sm"
              : "bg-pulse-surface text-pulse-text shadow-sm"
            : "text-pulse-text-dim hover:text-pulse-text",
          disabled && "pointer-events-none opacity-50",
        );
        const inner = (
          <>
            {o.label}
            {o.count ? (
              <span className={cn("data-mono rounded-full px-1.5 text-[11px]", selected ? "bg-pulse-gold/20 text-pulse-gold" : "bg-pulse-surface text-pulse-text-mute")}>
                {o.count}
              </span>
            ) : null}
          </>
        );
        return o.href ? (
          <Link key={o.value} href={o.href} scroll={false} role="tab" aria-selected={selected} className={cls}>
            {inner}
          </Link>
        ) : (
          <button key={o.value} type="button" role="tab" aria-selected={selected} disabled={disabled} onClick={() => onSelect?.(o.value)} className={cls}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/** A group of rows on one card, like a phone's settings. */
export function Group({ title, note, children, className }: { title?: string; note?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      {title && <h3 className="card-title px-1">{title}</h3>}
      <div className="divide-y divide-pulse-border overflow-hidden rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">{children}</div>
      {note && <p className="px-1 text-[12px] leading-relaxed text-pulse-text-mute">{note}</p>}
    </section>
  );
}

/** One row: what it is on the left (with a line under it if needed), its control on the right. */
export function Row({ label, detail, children, stack }: { label: React.ReactNode; detail?: React.ReactNode; children?: React.ReactNode; stack?: boolean }) {
  return (
    <div className={cn("flex gap-3 px-4 py-3.5", stack ? "flex-col" : "items-center justify-between")}>
      <div className="min-w-0">
        <p className="text-[15px] text-pulse-text">{label}</p>
        {detail && <p className="mt-0.5 text-[12px] leading-snug text-pulse-text-mute">{detail}</p>}
      </div>
      {children && <div className={cn(stack ? "w-full" : "shrink-0")}>{children}</div>}
    </div>
  );
}

export const field =
  "rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2 px-3 py-2 text-[15px] text-pulse-text placeholder:text-pulse-text-mute focus:border-pulse-border-strong focus:outline-none";
