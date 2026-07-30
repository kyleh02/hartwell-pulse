import { cn } from "@/lib/utils/cn";

/**
 * The real Ironpeak mark, taken from the brand SVG. Inline with
 * fill=currentColor so it recolours from CSS and stays crisp in print, rather
 * than a baked image that would go soft on a PDF.
 *
 * The viewBox is cropped to the mark's true bounds. The source asset is a
 * 400x400 social tile where the mark only fills about 56% by 44%, so drawing it
 * in that box rendered it at roughly half the requested size with transparent
 * padding around it. The mark is also wider than it is tall (225 by 175), so
 * `size` sets the HEIGHT and the width follows the real aspect ratio.
 */
const RATIO = 224.5 / 174.4;

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
      width={Math.round(size * RATIO)}
      viewBox="87.9 112.7 224.5 174.4"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path fill="currentColor" d="m611.28 298.1-.78.11-10 5.9-10 5.9-25.27 14.14-25.27 14.15.29.28.28.29 11.9 1.56 11.9 1.56.24.25.25.26-18.6 24-18.6 24-35.56 46.04-35.56 46.04-19.5 25.66-19.5 25.66-.5.04-.5.04L400.6 519l-15.87-15h-1.4l-3.98 4.75-3.98 4.75-16.9 21-16.91 21-12.94 16-12.93 16-32.03 40-32.03 40-12.48 15.46-12.48 15.45 2.55-1.95 2.55-1.96 19.87-17.62 19.87-17.62 34.94-30.11 34.93-30.11.27.27.28.27-1.02 12.77-1.02 12.78.3.86.32.86 22.13-43.14 22.14-43.13.9-.3.9-.3 13.11 15.26 13.12 15.27 1.93 1.75 1.94 1.75 21.6-27.26 21.6-27.25 36.2-45.5 36.19-45.5L553.3 402l21.03-26.5 8.59-10.78 8.59-10.78 7.3 7.65 7.29 7.66.3-.38.29-.37 1.2-18 1.19-18 .97-12.5.97-12.5.53-4.75.53-4.75zm-31.1 108.7-.68-.7-57.65 72.2-57.65 72.2-24.25 30.46-24.25 30.46-2.97 5.04-2.97 5.04-22 39-22 39-6.75 12-6.74 12-6.72 11.98-6.71 11.98 2.3-1.98 2.3-1.98 18.03-16.61 18.03-16.62 64.5-59.8 64.5-59.8 11.85-11.09 11.85-11.08 1.2-.69 1.2-.69 17.45 10.34 17.45 10.33.21-.19.22-.2-8.46-22.35-8.45-22.36 5.54-20.1 5.54-20.09 7.54-27.5 7.54-27.5.34-.34.33-.34 2.5 3.84 2.5 3.84 25.7 41 25.7 41 17.52 28.5 17.53 28.5 1.46 1.5 1.46 1.5-.54-2-.54-2-.69-22.25-.68-22.25h1.08l31.31 35.25 31.32 35.25 31.4 35 31.4 35 2.98 3 2.98 3-17.82-26.5-17.82-26.5-36.63-53.5-36.63-53.5-11.8-17-11.78-17-.26-.3-.26-.3-11.27 10.5-11.28 10.5-33.92-56.7-33.92-56.7z" transform="translate(88.00 112.65) scale(0.38821) translate(-227 -298)" />
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
  // lead element rather than sitting apologetically beside the word.
  const s =
    size === "lg"
      ? { text: "text-4xl", glyph: 44, gap: "gap-3" }
      : size === "sm"
        ? { text: "text-sm", glyph: 17, gap: "gap-1.5" }
        : { text: "text-xl", glyph: 24, gap: "gap-2" };
  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      <IronpeakMark size={s.glyph} className="shrink-0 text-pulse-text" />
      <span
        className={cn(
          "font-display font-semibold uppercase leading-none tracking-[0.14em] text-pulse-text",
          s.text,
        )}
      >
        Ironpeak
      </span>
    </span>
  );
}
