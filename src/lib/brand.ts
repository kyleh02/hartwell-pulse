import type { Brand } from "@/lib/types/database";

/**
 * The trading brands, in one place.
 *
 * Hartwell Digital and Ironpeak Consulting are the same legal entity and the
 * same ABN: Ironpeak is a registered business name against Hartwell Digital.
 * That is why every document reads the ABN from business_settings rather than
 * from here. What differs is only what a client sees on the page.
 *
 * Client-facing Ironpeak output must never mention Hartwell Digital. No "a
 * business of Hartwell Digital", no second logo. The bare ABN line is the only
 * permitted expression of the parent, and it needs no explanation. No phone
 * number appears on any public or client-facing Ironpeak document either.
 */
export const IRONPEAK = {
  name: "Ironpeak Consulting",
  email: "kyle@ironpeakconsulting.com.au",
  location: "Melbourne, working with defence suppliers across Australia",
} as const;

export const HARTWELL = {
  name: "Hartwell Digital",
  email: "kyle@hartwelldigital.com",
  site: "portal.hartwelldigital.com",
} as const;

export function isIronpeak(brand: Brand | string | null | undefined): boolean {
  return brand === "ironpeak";
}

/**
 * The classes that turn a surface into an Ironpeak document.
 *
 * doc-light flips the tokens to a white sheet, because Ironpeak's brand is
 * near-black and a dark document is hostile to print, burns toner and reads as
 * a novelty rather than something official. brand-ironpeak brings the real
 * typography: Clash Display for headings and the wordmark, Hanken Grotesk for
 * body, Geist Mono for every figure. Both are scoped so nothing leaks onto a
 * Hartwell surface.
 */
export const IRONPEAK_DOC_CLASS = "doc-light brand-ironpeak";
