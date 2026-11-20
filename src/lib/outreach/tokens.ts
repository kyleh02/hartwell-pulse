/**
 * Figures, days, page names and places in Claude's slots come from Pulse, never
 * from Claude (decision 3). Claude writes a token; Pulse fills it from its own
 * stored measurements and prospect fields at submit, and again from the lower
 * of the two confirming runs when the message is confirmed. A number in an
 * email can then never disagree with its proof. Pure, tested in tokens.test.ts.
 *
 * The tokens (TOKEN_GUIDE below is what the morning run is told):
 *   [[day]]            the weekday Pulse measured it, Melbourne time: "Tuesday"
 *   [[first_paint]]    the phone's first paint, worded: "a little over six seconds"
 *   [[largest_paint]]  the phone's largest paint, worded the same way
 *   [[page]]           the page name Claude gave, checked against the measured page
 *   [[broken_page]]    the broken menu page's name, checked against the menu
 *   [[area]]           the business's suburb or its postcode's region
 *   [[pageviews]]      how often the pixel counted one visit: "twice", "three times"
 */
import type { Fault } from "./rules.ts";

export const TOKENS = ["day", "first_paint", "largest_paint", "page", "broken_page", "area", "pageviews"] as const;
export type Token = (typeof TOKENS)[number];

/** The token a fault's figure must come through, where it has one. */
export const FAULT_TOKENS: Partial<Record<Fault, Token[]>> = {
  slow_mobile: ["first_paint", "largest_paint"],
  broken_page: ["broken_page"],
  pixel_double: ["pageviews"],
};

export const TOKEN_GUIDE = `Never write a number, a weekday, a month, a page name or a place yourself. Write a token and Pulse fills it from its own measurements:
[[day]] the weekday it was measured ("Tuesday")
[[first_paint]] how long the phone took to show anything ("a little over six seconds"); only when that was 4 seconds or more
[[largest_paint]] how long the main content took; only when that was 6 seconds or more
[[page]] the page name you give as page_name; it must match the measured page's address or its menu label
[[broken_page]] the broken menu page's name you give as broken_page_name
[[area]] the suburb or region you give as area; it must be the business's own suburb or the region its postcode is in
[[pageviews]] how many times the Meta Pixel counted one visit ("twice")
Any digit, weekday or month written out is refused.`;

/** Every [[token]] in a text, unknown ones included. */
export function tokensIn(text: string): string[] {
  return [...text.matchAll(/\[\[\s*([a-z_]+)\s*\]\]/g)].map((m) => m[1]);
}

export function isToken(t: string): t is Token {
  return (TOKENS as readonly string[]).includes(t);
}

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** A whole number as Australian copy writes it: words to twenty, digits after. */
export function numberWord(n: number): string {
  return n >= 0 && n <= 20 ? SMALL[n] : String(n);
}

/**
 * A load time, rounded DOWN and worded: 6400 ms is "a little over six
 * seconds", 6050 ms is "six seconds". Never rounded up, so it never says
 * more than was measured.
 */
export function secondsWords(ms: number): string {
  const whole = Math.floor(ms / 1000);
  const unit = whole === 1 ? "second" : "seconds";
  return ms - whole * 1000 >= 100 ? `a little over ${numberWord(whole)} ${unit}` : `${numberWord(whole)} ${unit}`;
}

/** How many times a pixel counted one visit, worded. */
export function timesWords(n: number): string {
  return n === 2 ? "twice" : `${numberWord(n)} times`;
}

/** The weekday of a moment in Melbourne. */
export function melbourneWeekday(at: string | Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long" }).format(new Date(at));
}

/** A page or place name for comparing: lower case, words only, simple plurals singular. */
export function nameKey(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

/** What a measured page may be called: "home" at the root, else its last path segment's words. */
export function pageNamesFor(url: string, menuLabels: string[] = []): Set<string> {
  const out = new Set<string>();
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length === 0) {
      out.add("home");
      out.add("homepage");
      out.add("home page");
    } else {
      const last = decodeURIComponent(segs[segs.length - 1]).replace(/\.(html?|php|aspx?)$/i, "");
      out.add(nameKey(last.replace(/[-_]+/g, " ")));
    }
  } catch {
    // no name from a bad address
  }
  for (const l of menuLabels) if (nameKey(l)) out.add(nameKey(l));
  out.delete("");
  return out;
}

/**
 * Regions a postcode sits in, for [[area]]. Postcode ranges, deliberately
 * rough: a region is only allowed when the business's postcode is inside it.
 */
const REGIONS: { name: string; ranges: [number, number][] }[] = [
  { name: "Sunshine Coast", ranges: [[4550, 4575]] },
  { name: "Noosa", ranges: [[4565, 4567], [4571, 4573]] },
  { name: "Melbourne", ranges: [[3000, 3210], [3335, 3341], [3427, 3438], [3750, 3810], [3910, 3944], [3975, 3978]] },
  { name: "Yarra Valley", ranges: [[3770, 3799]] },
  { name: "Mornington Peninsula", ranges: [[3910, 3944]] },
];

export function regionsFor(postcode: string | null | undefined): string[] {
  const n = Number(postcode);
  if (!/^[0-9]{4}$/.test(postcode ?? "")) return [];
  return REGIONS.filter((r) => r.ranges.some(([a, b]) => n >= a && n <= b)).map((r) => r.name);
}

/**
 * The places [[area]] may name: the business's own suburb, or a region its
 * postcode is in. Not the lane's other areas: "shops around Bayswater" in an
 * email to a Caloundra business would be a claim about where we looked that
 * the business can see is wrong.
 */
export function allowedAreas(prospect: { suburb: string | null; postcode: string | null }): Set<string> {
  const out = new Set<string>();
  if (prospect.suburb) out.add(nameKey(prospect.suburb));
  for (const r of regionsFor(prospect.postcode)) out.add(nameKey(r));
  out.delete("");
  return out;
}
