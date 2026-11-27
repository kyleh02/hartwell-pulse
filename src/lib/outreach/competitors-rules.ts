/**
 * The free review's competitor search (Kyle, 27 November 2026: "describe
 * local competitors, I think we should name them", and the PC run may search
 * the morning after a yes). The run searches Meta's Ad Library for the
 * business's service and area, reads the result pages' visible text, and
 * picks the local advertisers worth naming, each with its own domain and the
 * opening words of one of its ads. Pulse reads the pages itself: an
 * advertiser is only named when an active ad on the pages shows its domain,
 * its name is the library's own page name, its ad count and start date are
 * counted from the cards, and the quote must open one of its ads' lines,
 * word for word. The run's reading is never stored as the fact.
 * Pure; competitors-rules.test.ts.
 */
import { adCards, cardShows, type AdCard } from "./ad-cards.ts";
import { plainText } from "./give-first.ts";
import { nameKey } from "./tokens.ts";
import { normaliseDomain } from "./normalise.ts";

export const MAX_COMPETITORS = 5;
export const MAX_COMPETITOR_PAGES = 10;
export const COMPETITOR_PAGE_CHARS = 15000;

export interface Competitor {
  /** The advertiser's page name as the library shows it, without "Pty Ltd". */
  name: string;
  domain: string;
  /** Where they're based, from their own site, as the run read it. */
  suburb: string | null;
  /** The opening words of one of their live ads, word for word. */
  quote: string;
  /** Active ads on the pages showing their domain. */
  ads: number;
  /** The earliest of those ads' "Started running on", YYYY-MM-DD. */
  started: string | null;
}

export interface CompetitorCheck {
  checked_at: string;
  /** "window tinting": as in "other window tinting businesses". */
  service: string;
  /** "the Gold Coast": as in "around the Gold Coast". */
  area: string;
  competitors: Competitor[];
  /** How many library pages the run read. */
  pages: number;
  library_urls: string[];
}

export interface CompetitorPick {
  domain: string;
  suburb?: string | null;
  quote: string;
}

/** A Meta Ad Library keyword search for active Australian ads. */
export function competitorSearchUrl(words: string): string {
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=AU&q=${encodeURIComponent(words.trim().toLowerCase().replace(/\s+/g, " "))}&search_type=keyword_unordered&media_type=all`;
}

/** Why an address isn't a Meta Ad Library search, or null. */
export function searchUrlProblem(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "www.facebook.com" || !u.pathname.startsWith("/ads/library")) return "library_urls are Meta Ad Library searches (https://www.facebook.com/ads/library/...).";
    if (!u.searchParams.get("q")) return "Each library_url is a keyword search with q= in it.";
    return null;
  } catch {
    return "A library_url isn't an address.";
  }
}

const words = (s: string) => s.split(" ").filter(Boolean).length;

/** "window tinting", "ute canopy", "caravan repair": lower case, one to four words. */
export function serviceProblem(s: string): string | null {
  const t = plainText(s);
  if (!/^[a-z][a-z '&-]*[a-z]$/.test(t) || words(t) > 4 || t.length > 32) return 'service is the trade in one to four lower-case words, as an owner would say it ("window tinting", "ute canopy").';
  return null;
}

/** "the Gold Coast", "Brisbane's north side": a place in one to five words. */
export function areaProblem(s: string): string | null {
  const t = plainText(s);
  if (!/^[A-Za-z][A-Za-z '’]*[A-Za-z]$/.test(t) || words(t) > 5 || t.length > 40) return 'area is the place in one to five words, as in "around the Gold Coast".';
  return null;
}

/** A suburb or town: letters, one to three words. */
export function suburbProblem(s: string): string | null {
  const t = plainText(s);
  if (!/^[A-Za-z][A-Za-z '’-]*[A-Za-z]$/.test(t) || words(t) > 3 || t.length > 30) return "suburb is a suburb or town in one to three words, or leave it out.";
  return null;
}

/** Three to twelve plain words: no prices, percentages, emoji or quote marks, and no punctuation at the end. */
export function leadQuoteProblem(q: string): string | null {
  const t = plainText(q);
  if (words(t) < 3 || words(t) > 12) return "quote is three to twelve words copied from the start of one of their ad's lines.";
  if (!/^[A-Za-z0-9][A-Za-z0-9 ,'’&]*[A-Za-z0-9]$/.test(t)) return "quote must be plain words: no prices, percentages, emoji, dashes, quote marks or punctuation at the end.";
  return null;
}

const fold = (s: string) => plainText(s).replace(/[’‘]/g, "'").toLowerCase();

/** The library's page name without "Pty Ltd" and trailing dots. */
export function cleanName(name: string): string {
  return plainText(name)
    .replace(/\b(pty\.?\s*ltd\.?|pty\.?|ltd\.?|limited)(?=\s|$)/gi, "")
    .replace(/[\s,.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mostCommon(xs: string[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Pulse's reading of the run's picks against the pages it read. Every
 * problem is listed, so the run can fix them all at once.
 */
export function readCompetitors(
  pageTexts: string[],
  picks: CompetitorPick[],
  own: { domain: string | null; name: string | null },
): { ok: true; competitors: Competitor[] } | { ok: false; problems: string[] } {
  const cards: AdCard[] = [];
  const seen = new Set<string>();
  for (const text of pageTexts) {
    for (const c of adCards(text)) {
      if (!c.active || seen.has(c.libraryId)) continue;
      seen.add(c.libraryId);
      cards.push(c);
    }
  }
  const problems: string[] = [];
  const out: Competitor[] = [];
  const used = new Set<string>();
  for (const p of picks.slice(0, MAX_COMPETITORS)) {
    const d = normaliseDomain(p.domain);
    if (!d) {
      problems.push(`"${p.domain}" isn't a website domain.`);
      continue;
    }
    if (own.domain && d === own.domain) {
      problems.push(`${d} is the business's own site.`);
      continue;
    }
    if (used.has(d)) {
      problems.push(`${d} is in the list twice.`);
      continue;
    }
    used.add(d);
    const theirs = cards.filter((c) => cardShows(c, d));
    if (!theirs.length) {
      problems.push(`${d}: no active ad on the pages you passed shows ${d.toUpperCase()}. Name only advertisers whose ads show their own domain.`);
      continue;
    }
    const name = cleanName(mostCommon(theirs.map((c) => c.name).filter((x): x is string => !!x)) ?? "");
    if (!name) {
      problems.push(`${d}: its ads show no page name above "Sponsored".`);
      continue;
    }
    if (own.name && nameKey(name) === nameKey(own.name)) {
      problems.push(`${d}: that's the business itself.`);
      continue;
    }
    const qBad = leadQuoteProblem(p.quote);
    if (qBad) {
      problems.push(`${d}: ${qBad}`);
      continue;
    }
    const q = fold(p.quote);
    const opens = theirs.some((c) => c.body.some((l) => fold(l).replace(/^[^a-z0-9]+/, "").startsWith(q)));
    if (!opens) {
      problems.push(`${d}: "${plainText(p.quote)}" doesn't open any line of its active ads. Copy the first three to twelve words of one line exactly.`);
      continue;
    }
    const sub = p.suburb ? plainText(p.suburb) : null;
    if (sub) {
      const sBad = suburbProblem(sub);
      if (sBad) {
        problems.push(`${d}: ${sBad}`);
        continue;
      }
    }
    const starts = theirs.map((c) => c.started).filter((x): x is string => !!x).sort();
    out.push({ name, domain: d, suburb: sub, quote: plainText(p.quote), ads: theirs.length, started: starts[0] ?? null });
  }
  if (picks.length > MAX_COMPETITORS) problems.push(`Five competitors at most: pick the ${MAX_COMPETITORS} most worth naming.`);
  return problems.length ? { ok: false, problems } : { ok: true, competitors: out };
}
