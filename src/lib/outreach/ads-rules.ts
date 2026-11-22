/**
 * Ad-library evidence (Draper v2, 22 November 2026). Kyle's decision: a
 * business only gets an email when its ads are live, shown by Meta's Ad
 * Library or Google's Ads Transparency Centre, checked per business. A tag on
 * the site is not proof: tags stay for years after the ads stop, and a Shopify
 * store can run ads with no tag Pulse can see.
 *
 * Pulse can't open either library itself (Meta forbids automated collection
 * and refuses servers; Google's page is a script shell with no data in it), so
 * the morning run reads them in Kyle's Chrome and hands over the page TEXT.
 * Pulse reads that text itself, here: which ads are active, when they started
 * or were last shown, and whether they point at the business's own domain.
 * What Claude says it saw is never stored as the fact; this file's reading is.
 *
 * What counts as live (decided 22 November 2026, docs/DRAPER-PLAN-2.md):
 *   - Meta: an ad marked Active whose card shows the business's own domain,
 *     from a library search for that domain in Australia, active ads only.
 *   - Google: the domain search for Australia lists ads for their domain, and
 *     one of those ads was last shown in Australia within 14 days of the check.
 *
 * Pure; ads-rules.test.ts (fixtures are real page text from 22 Nov 2026).
 */
import { normaliseDomain } from "./normalise.ts";

export type AdPlatform = "meta" | "google";

/** How old a check may be: when the draft is submitted, confirmed, and sent. */
export const ADS_MAX_AGE_HOURS = { submit: 36, confirm: 48, send: 96 } as const;
/** A Google ad last shown this many days before the check still counts as running. */
export const GOOGLE_RECENT_DAYS = 14;
/** The most page text kept per check. */
export const MAX_ADS_TEXT = 6000;

/** The library searches the morning run opens, built by Pulse so the filters are always right. */
export function libraryUrls(domain: string): { meta: string; google: string } {
  const d = encodeURIComponent(domain);
  return {
    meta: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=AU&q=${d}&search_type=keyword_unordered&media_type=all`,
    google: `https://adstransparency.google.com/?region=AU&domain=${d}`,
  };
}

function parse(url: string): URL | null {
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

/** Why a library address can't back a claim about this domain, or null when it can. */
export function libraryUrlProblem(platform: AdPlatform, url: string, domain: string): string | null {
  const u = parse(url);
  if (!u || u.protocol !== "https:") return "library_url isn't a web address.";
  const q = u.searchParams;
  if (platform === "meta") {
    if (!/^(www\.|m\.)?facebook\.com$/.test(u.hostname) || !u.pathname.startsWith("/ads/library")) return "library_url must be Meta's Ad Library (facebook.com/ads/library).";
    if (q.get("country") !== "AU") return "The Ad Library search must be for Australia (country=AU).";
    if (q.get("active_status") !== "active") return "The Ad Library search must be active ads only (active_status=active).";
    if (normaliseDomain(q.get("q") ?? "") !== domain) return `The Ad Library search must be for their domain, ${domain}. Use the address outreach_ads_queue gives.`;
    return null;
  }
  if (u.hostname !== "adstransparency.google.com") return "library_url must be Google's Ads Transparency Centre.";
  if (q.get("region") !== "AU") return "The Transparency Centre search must be for Australia (region=AU).";
  if (normaliseDomain(q.get("domain") ?? "") !== domain) return `The Transparency Centre search must be for their domain, ${domain}. Use the address outreach_ads_queue gives.`;
  return null;
}

/** Why an ad's own page on the Transparency Centre can't be used, or null. */
export function googleAdUrlProblem(url: string): string | null {
  const u = parse(url);
  if (!u || u.hostname !== "adstransparency.google.com") return "ad_url must be an ad's page on Google's Ads Transparency Centre.";
  if (!/^\/advertiser\/AR\d+\/creative\/CR\d+\/?$/.test(u.pathname)) return "ad_url must be one ad's page (…/advertiser/AR…/creative/CR…).";
  if (u.searchParams.get("region") !== "AU") return "ad_url must be the Australian view (region=AU).";
  return null;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** "Dec 22, 2024" or "22 Dec 2024" (either library, either locale) as YYYY-MM-DD. */
export function libraryDate(s: string): string | null {
  const t = s.trim();
  let m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  let day: number, mon: number | undefined, year: number;
  if (m) {
    mon = MONTHS[m[1].slice(0, m[1].toLowerCase().startsWith("sept") ? 4 : 3).toLowerCase()];
    day = Number(m[2]);
    year = Number(m[3]);
  } else {
    m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t);
    if (!m) return null;
    day = Number(m[1]);
    mon = MONTHS[m[2].slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3).toLowerCase()];
    year = Number(m[3]);
  }
  if (mon === undefined || day < 1 || day > 31 || year < 2000) return null;
  const d = new Date(Date.UTC(year, mon, day));
  if (d.getUTCMonth() !== mon) return null;
  return d.toISOString().slice(0, 10);
}

const DATE = String.raw`(?:[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})`;

/** Zero-width characters the libraries scatter through their text. */
function clean(text: string): string {
  return text.replace(/[​‌‍⁠﻿]/g, "").replace(/\r/g, "");
}

function mentions(text: string, domain: string): boolean {
  return text.toLowerCase().includes(domain.toLowerCase());
}

export interface MetaReading {
  /** Ads marked Active on the page. */
  active: number;
  /** Active ads whose card shows the business's own domain. */
  activeOnDomain: number;
  /** The earliest "Started running on" among those, YYYY-MM-DD. */
  earliestStart: string | null;
  libraryIds: string[];
}

/**
 * Pulse's reading of an Ad Library results page. Each ad card starts
 * "Active" (or "Inactive") then "Library ID: …", then "Started running on …";
 * a link ad's card shows the destination domain in capitals.
 */
export function readMetaText(text: string, domain: string): MetaReading {
  const t = clean(text);
  const starts = [...t.matchAll(/(?:^|\n)\s*(Active|Inactive)\s*\n\s*Library ID:?\s*(\d{6,})/g)];
  const out: MetaReading = { active: 0, activeOnDomain: 0, earliestStart: null, libraryIds: [] };
  starts.forEach((m, i) => {
    const card = t.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index! : t.length);
    if (m[1] !== "Active") return;
    out.active++;
    if (!mentions(card, domain)) return;
    out.activeOnDomain++;
    out.libraryIds.push(m[2]);
    const started = new RegExp(`Started running on\\s+(${DATE})`).exec(card);
    const d = started ? libraryDate(started[1]) : null;
    if (d && (!out.earliestStart || d < out.earliestStart)) out.earliestStart = d;
  });
  return out;
}

export interface GoogleReading {
  /** Ads the domain search lists for the domain. */
  ads: number;
  /** The domain search page names their domain. */
  domainShown: boolean;
  /** "Last shown" on the ad's own page, YYYY-MM-DD. */
  lastShown: string | null;
  /** The ad's page says it was shown in Australia. */
  shownInAustralia: boolean;
}

/** Pulse's reading of the Transparency Centre: the domain search, then one ad's own page. */
export function readGoogleText(searchText: string, adText: string, domain: string): GoogleReading {
  const s = clean(searchText);
  const a = clean(adText);
  const count = /(?:^|\n)\s*(\d{1,5})\s+ads?\s*(?:\n|$)/i.exec(s);
  const last = new RegExp(`Last shown:?\\s*(${DATE})`, "i").exec(a);
  return {
    ads: count ? Number(count[1]) : 0,
    domainShown: mentions(s, domain),
    lastShown: last ? libraryDate(last[1]) : null,
    shownInAustralia: /Shown in Australia/i.test(a),
  };
}

/** One check, as stored: Pulse's reading, never Claude's. */
export interface AdsEvidence {
  platform: AdPlatform;
  /** Pulse's clock when the check was recorded. */
  checked_at: string;
  library_url: string;
  ad_url: string | null;
  /** Live ads tied to the business's own domain. */
  live: boolean;
  ads: number;
  started: string | null;
  last_shown: string | null;
  /** What Pulse found, in a line. */
  note: string;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export interface AdsCheckInput {
  platform: AdPlatform;
  library_url: string;
  page_text: string;
  ad_url?: string | null;
  ad_text?: string | null;
}

/**
 * Turn a check the morning run made into evidence, or say what's wrong with
 * it. `today` is the Melbourne date of the check (YYYY-MM-DD).
 */
export function readAdsCheck(input: AdsCheckInput, domain: string, now: Date, today: string): { evidence: AdsEvidence } | { problems: string[] } {
  const problems: string[] = [];
  const urlProblem = libraryUrlProblem(input.platform, input.library_url, domain);
  if (urlProblem) problems.push(urlProblem);
  const text = (input.page_text ?? "").slice(0, MAX_ADS_TEXT);
  if (text.trim().length < 40) problems.push("page_text is empty: copy the page's visible text (document.body.innerText).");
  const base = { platform: input.platform, checked_at: now.toISOString(), library_url: input.library_url.trim() };

  if (input.platform === "meta") {
    if (problems.length) return { problems };
    if (/Library ID/i.test(text) === false && !/no ads match|isn't running ads|0 results/i.test(text)) {
      return { problems: ["That doesn't read like an Ad Library results page. Wait for the results to load, then copy the page text again."] };
    }
    const r = readMetaText(text, domain);
    const live = r.activeOnDomain > 0;
    return {
      evidence: {
        ...base,
        ad_url: null,
        live,
        ads: r.activeOnDomain,
        started: r.earliestStart,
        last_shown: null,
        note: live
          ? `${r.activeOnDomain} active Meta ad${r.activeOnDomain === 1 ? "" : "s"} pointing to ${domain}${r.earliestStart ? `, the earliest started ${r.earliestStart}` : ""}`
          : r.active
            ? `${r.active} active Meta ad${r.active === 1 ? "" : "s"} matched the search, none showing ${domain}`
            : "No active Meta ads for the domain",
      },
    };
  }

  // Google: the domain search, and (when it lists ads) one ad's own page.
  const g = readGoogleText(text, input.ad_text ?? "", domain);
  if (g.ads > 0) {
    if (!input.ad_url || !input.ad_text) problems.push("The search lists ads: open the most recent one and pass ad_url and ad_text (its page text, with Last shown).");
    else {
      const adProblem = googleAdUrlProblem(input.ad_url);
      if (adProblem) problems.push(adProblem);
      if (!g.lastShown) problems.push('ad_text has no "Last shown" date. Copy the ad page\'s text once it has loaded.');
      if (!g.shownInAustralia) problems.push('ad_text doesn\'t say "Shown in Australia". Use the Australian view of the ad.');
    }
  }
  if (!g.domainShown) problems.push(`page_text doesn't show ${domain}. Copy the domain search's text once it has loaded.`);
  if (problems.length) return { problems };
  const age = g.lastShown ? daysBetween(g.lastShown, today) : null;
  const live = g.ads > 0 && age !== null && age >= 0 && age <= GOOGLE_RECENT_DAYS;
  return {
    evidence: {
      ...base,
      ad_url: input.ad_url?.trim() ?? null,
      live,
      ads: g.ads,
      started: null,
      last_shown: g.lastShown,
      note: g.ads === 0
        ? "No Google ads listed for the domain in Australia"
        : live
          ? `${g.ads} Google ad${g.ads === 1 ? "" : "s"} for ${domain}, one last shown ${g.lastShown}`
          : `${g.ads} Google ad${g.ads === 1 ? "" : "s"} for ${domain}, but the one checked was last shown ${g.lastShown}, more than ${GOOGLE_RECENT_DAYS} days before the check`,
    },
  };
}

/** The live platforms in a business's checks no older than `maxHours`, newest check per platform. */
export function liveAds(evidence: AdsEvidence[], now: Date, maxHours: number): { platforms: AdPlatform[]; checkedAt: string | null } {
  const newest = new Map<AdPlatform, AdsEvidence>();
  for (const e of evidence) {
    const cur = newest.get(e.platform);
    if (!cur || e.checked_at > cur.checked_at) newest.set(e.platform, e);
  }
  const fresh = [...newest.values()].filter((e) => e.live && now.getTime() - Date.parse(e.checked_at) <= maxHours * 3_600_000);
  const platforms = (["google", "meta"] as const).filter((p) => fresh.some((e) => e.platform === p));
  const checkedAt = fresh.length ? fresh.map((e) => e.checked_at).sort()[0] : null;
  return { platforms, checkedAt };
}

/**
 * [[ad_platform]] and the subject's {ad_platform}. "Facebook", not "Facebook
 * and Instagram": the library's text can't say which placements an ad uses,
 * and nearly every Page ad runs on Facebook.
 */
export function platformWords(platforms: AdPlatform[]): string | null {
  const g = platforms.includes("google");
  const m = platforms.includes("meta");
  return g && m ? "Google and Facebook" : g ? "Google" : m ? "Facebook" : null;
}
