/**
 * The cards on a Meta Ad Library results page, as Pulse reads them from the
 * page's visible text. Each card starts "Active" (or "Inactive") then
 * "Library ID: …", then "Started running on …"; the advertiser's page name
 * sits on the line before "Sponsored", the ad's words after it, and a link
 * ad shows its destination domain in capitals. Shared by the free review's
 * own-ad check and its competitor search. Pure; review-draft.test.ts and
 * competitors-rules.test.ts.
 */
import { plainText } from "./give-first.ts";
import { libraryDate } from "./ads-rules.ts";

export interface AdCard {
  active: boolean;
  libraryId: string;
  /** "Started running on", YYYY-MM-DD. */
  started: string | null;
  /** The advertiser's page name, as the library shows it. */
  name: string | null;
  /** The card's lines after "Sponsored": the ad's words, its domain, headline and button. */
  body: string[];
  /** The card's own text, for finding a domain in it. */
  raw: string;
}

const STARTED = /Started running on\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})/;

export function adCards(pageText: string): AdCard[] {
  const t = pageText.replace(/[​-‍⁠﻿]/g, "").replace(/\r/g, "");
  const starts = [...t.matchAll(/(?:^|\n)\s*(Active|Inactive)\s*\n\s*Library ID:?\s*(\d{6,})/g)];
  return starts.map((m, i) => {
    const raw = t.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : t.length);
    const lines = raw.split("\n").map((l) => plainText(l)).filter(Boolean);
    const at = lines.indexOf("Sponsored");
    const started = STARTED.exec(raw);
    return {
      active: m[1] === "Active",
      libraryId: m[2],
      started: started ? libraryDate(started[1]) : null,
      name: at > 0 ? lines[at - 1] : null,
      body: at >= 0 ? lines.slice(at + 1) : [],
      raw,
    };
  });
}

/** A line that is only a domain in capitals, the way a link ad shows its site. */
export function isDomainLine(s: string): boolean {
  return /^[A-Z0-9-]+(\.[A-Z]{2,})+$/.test(s);
}

/** The card shows this domain, as a whole domain ("tint.com.au" isn't in "blacktint.com.au"). */
export function cardShows(card: AdCard, domain: string): boolean {
  const d = domain.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9.-])(www\\.)?${d}(?![a-z0-9-]|\\.[a-z0-9])`).test(card.raw.toLowerCase());
}

/** The ad's own opening words: its first line after "Sponsored" that isn't a domain. */
export function openingLine(card: AdCard): string | null {
  return card.body.find((l) => !isDomainLine(l)) ?? null;
}
