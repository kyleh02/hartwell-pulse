import { cn } from "@/lib/utils/cn";
import { IronpeakDotMark } from "@/components/brand/IronpeakDotMark";

/**
 * The Ironpeak mountain mark, solid. Inline with fill=currentColor so it
 * recolours from CSS and stays crisp in print, rather than a baked image that
 * would go soft on a PDF.
 *
 * Copied exactly from the brand kit's
 * `Logo/Ironpeak Mountain Mark (Oct 2026)/01 Mark SVG/ironpeak-mountain-mark-currentcolor.svg`:
 * one shape, 39 points, in the kit's own 575.5 by 372.25 box. It replaced the
 * arrow mark on 5 October 2026, and the portal followed on 2 November. Change
 * it in the kit and copy it here, never by hand.
 *
 * This is the small-size mark: badges, the letterhead switch, anything under
 * about 40px. At that size the dot version reads as a grey texture. Above it,
 * use IronpeakDotMark, which is what Kyle gave the invoices. The mark is wider
 * than it is tall, so `size` sets the HEIGHT.
 */
const W = 575.5;
const H = 372.25;

export function IronpeakMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      height={size}
      width={Math.round((size * W) / H)}
      viewBox={`0 0 ${W} ${H}`}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M311.00 0.00 L316.75 6.50 L338.50 37.50 L341.00 42.50 L342.75 41.75 L351.00 31.25 L352.75 32.75 L420.00 145.50 L421.75 145.00 L441.25 126.25 L443.75 125.50 L537.50 261.75 L575.50 319.00 L498.00 233.50 L444.50 172.75 L443.25 174.00 L445.50 221.00 L444.00 220.25 L364.50 91.75 L352.50 72.75 L324.75 167.25 L341.75 212.50 L305.75 192.00 L111.00 372.25 L186.75 237.00 L327.50 60.75 L327.75 58.25 L326.75 56.25 L315.75 40.50 L188.50 199.00 L157.25 164.25 L112.50 252.00 L111.50 250.25 L113.75 225.00 L0.00 322.00 L153.75 130.00 L156.25 128.50 L183.75 155.00 L188.25 159.00Z" />
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
  // Glyph height is set a touch above the text size so the mark reads as the
  // lead element rather than sitting apologetically beside the word. The large
  // size is the letterhead on a report, and it wears the dot mountain in steel,
  // the same lockup as the invoices, in about the kit's proportions (the word's
  // capitals a little over a third of the mark's height). On the white document
  // that steel is the kit's steel-deep (see .doc-light).
  const s =
    size === "lg"
      ? { text: "text-[22px] sm:text-[28px]", glyph: 60, gap: "gap-4 sm:gap-5" }
      : size === "sm"
        ? { text: "text-sm", glyph: 17, gap: "gap-1.5" }
        : { text: "text-xl", glyph: 24, gap: "gap-2" };
  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      {size === "lg" ? (
        // A step smaller on a phone, where the full size runs past the sheet's
        // padding. CSS height wins over the attribute and the width follows
        // the viewBox, so the dots keep their shape.
        <IronpeakDotMark size={s.glyph} className="h-12 w-auto text-pulse-steel sm:h-[60px]" />
      ) : (
        <IronpeakMark size={s.glyph} className="shrink-0 text-pulse-text" />
      )}
      {/* Clash Display Bold, widely spaced, as the kit's lockups set it. The
          spacing is inline because inside a report .brand-ironpeak sets every
          .font-display to -0.01em, and a utility class loses to that. */}
      <span
        className={cn("font-display font-bold uppercase leading-none text-pulse-text", s.text)}
        style={{ letterSpacing: "0.2em" }}
      >
        Ironpeak
      </span>
    </span>
  );
}
