import { cn } from "@/lib/utils/cn";

/**
 * The Ironpeak mark and wordmark. Rendered as inline SVG plus live text rather
 * than a baked image, so it stays crisp at any size, recolours from CSS and
 * remains selectable, which is how the Ironpeak site does it.
 *
 * The wordmark is deliberately alone: on anything a client or prospect sees,
 * Ironpeak must not read as a sub-brand of Hartwell Digital. The ABN line is
 * the only permitted expression of the parent entity.
 */
export function IronpeakMark({
  size = 22,
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
        d="M2 20 L9 6 L13 13 L16 9 L22 20 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IronpeakWordmark({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const s =
    size === "lg"
      ? { text: "text-lg", glyph: 26, gap: "gap-2.5" }
      : size === "sm"
        ? { text: "text-xs", glyph: 15, gap: "gap-1.5" }
        : { text: "text-sm", glyph: 20, gap: "gap-2" };
  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      <IronpeakMark size={s.glyph} className="text-pulse-gold" />
      <span
        className={cn(
          "font-semibold uppercase tracking-[0.18em] text-pulse-text",
          s.text,
        )}
      >
        Ironpeak
      </span>
    </span>
  );
}
