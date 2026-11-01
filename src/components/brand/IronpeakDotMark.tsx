import { cn } from "@/lib/utils/cn";

/**
 * The Ironpeak mountain mark in dots: the logo Kyle gave the invoices on
 * 2 November 2026, and the one on Ironpeak's Google and LinkedIn profiles.
 *
 * Taken exactly from the brand kit's
 * `Logo/Ironpeak Mountain Mark (Oct 2026)/09 Dot mark/ironpeak-dot-mark-currentcolor.svg`
 * in the Ironpeak Drive folder: the same 258 dots, the same 3.6 radius, the
 * same 460 by 300 box. That file sits every dot on a 10 unit grid, so each row
 * below lists the columns lit in it, top row first; dot (col, row) is centred
 * at (10 col + 5, 10 row + 5). The kit's rule is that the dot mark is used as
 * it is and never redrawn, so change it there and copy it here, never by hand.
 *
 * Fill is currentColor, so it takes the brand's steel or white from CSS. Size
 * sets the HEIGHT. The dots are fine, so it wants roughly 40px or more to read
 * as dots rather than a texture; below that use the solid IronpeakMark.
 */
const ROWS: number[][] = [
  [24],
  [24, 25],
  [23, 24, 25, 26],
  [22, 23, 24, 25, 26, 27, 28],
  [21, 22, 23, 26, 27, 28],
  [20, 21, 22, 25, 26, 27, 28, 29],
  [20, 21, 22, 25, 26, 27, 28, 29, 30],
  [19, 20, 21, 24, 25, 26, 27, 29, 30],
  [18, 19, 20, 23, 24, 25, 26, 27, 30, 31],
  [17, 18, 19, 22, 23, 24, 25, 26, 30, 31],
  [12, 17, 18, 19, 22, 23, 24, 25, 26, 31, 32, 35],
  [11, 12, 13, 16, 17, 18, 21, 22, 23, 24, 25, 26, 32, 33, 34, 35, 36],
  [11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 24, 25, 32, 33, 34, 35, 36],
  [10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 33, 34, 35, 36, 37],
  [9, 10, 11, 14, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 33, 34, 35, 36, 37, 38],
  [8, 9, 10, 11, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 34, 35, 37, 38],
  [7, 8, 9, 10, 17, 18, 19, 20, 21, 22, 26, 35, 38, 39],
  [6, 7, 8, 9, 16, 17, 18, 19, 20, 21, 39, 40],
  [6, 7, 8, 9, 15, 16, 17, 18, 19, 20, 40],
  [5, 6, 14, 15, 16, 17, 18, 19, 40, 41],
  [4, 5, 14, 15, 16, 17, 18, 41, 42],
  [3, 4, 13, 14, 15, 16, 17, 42],
  [2, 3, 13, 14, 15, 16, 43],
  [2, 12, 13, 14, 15, 44],
  [1, 12, 13, 14],
  [11, 12, 13],
  [11, 12],
  [10],
  [9],
];

const W = 460;
const H = 300;

export function IronpeakDotMark({
  size = 48,
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
      className={cn("shrink-0", className)}
    >
      {ROWS.flatMap((cols, row) =>
        cols.map((col) => (
          <circle key={`${row}-${col}`} cx={col * 10 + 5} cy={row * 10 + 5} r={3.6} />
        )),
      )}
    </svg>
  );
}
