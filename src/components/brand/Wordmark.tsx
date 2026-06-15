import { cn } from "@/lib/utils/cn";

const SIZES = {
  sm: { text: "text-xs", glyph: 14, gap: "gap-1.5" },
  md: { text: "text-sm", glyph: 18, gap: "gap-2" },
  lg: { text: "text-lg", glyph: 24, gap: "gap-2.5" },
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

export function Wordmark({
  size = "md",
  withGlyph = true,
  className,
}: {
  size?: keyof typeof SIZES;
  withGlyph?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      className={cn("inline-flex items-center select-none", s.gap, className)}
      aria-label="Hartwell Pulse"
    >
      {withGlyph && (
        <PulseGlyph size={s.glyph} className="text-pulse-gold shrink-0" />
      )}
      <span className={cn("inline-flex items-baseline gap-1.5", s.text)}>
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
