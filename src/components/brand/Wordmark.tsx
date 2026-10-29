import { cn } from "@/lib/utils/cn";
import { HdMark } from "@/components/brand/HdMark";

const SIZES = {
  sm: { text: "text-xs", glyph: 14, mark: 22, gap: "gap-1.5", markGap: "gap-2" },
  md: { text: "text-sm", glyph: 18, mark: 30, gap: "gap-2", markGap: "gap-3" },
  lg: { text: "text-lg", glyph: 24, mark: 40, gap: "gap-2.5", markGap: "gap-3.5" },
} as const;

/** A stylised pulse/heartbeat line — the Pulse glyph. */
export function PulseGlyph({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2 12h4l2.5-6 4 14 3-8 2 4h4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * "HARTWELL PULSE". With `mark="hd"` it leads with the Hartwell Digital
 * monogram turning in 3D (HdMark) instead of the pulse line: the portal shell's
 * top left uses that, and printed documents keep the flat pulse glyph.
 */
export function Wordmark({
  size = "md",
  withGlyph = true,
  mark = "pulse",
  className,
  textClassName,
}: {
  size?: keyof typeof SIZES;
  withGlyph?: boolean;
  mark?: "pulse" | "hd";
  className?: string;
  /** On the words only, e.g. to drop them where a header is too narrow. */
  textClassName?: string;
}) {
  const s = SIZES[size];
  const hd = withGlyph && mark === "hd";
  return (
    <span
      className={cn("inline-flex items-center select-none", hd ? s.markGap : s.gap, className)}
      aria-label="Hartwell Pulse"
    >
      {hd && <HdMark size={s.mark} label={null} />}
      {withGlyph && !hd && (
        <PulseGlyph size={s.glyph} className="text-pulse-gold shrink-0" />
      )}
      <span className={cn("inline-flex items-baseline gap-1.5", s.text, textClassName)}>
        <span className="font-sans font-semibold tracking-[0.18em] text-pulse-text">
          HARTWELL
        </span>
        <span className="data-mono font-medium tracking-[0.28em] text-pulse-gold">
          PULSE
        </span>
      </span>
    </span>
  );
}
