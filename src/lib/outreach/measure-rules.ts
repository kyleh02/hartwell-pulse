/**
 * Draper's measuring tool, the rules (Stage 3). Everything here reads text
 * Pulse has already fetched and decides what it shows, with no I/O, so it can
 * be tested against fixed pages. The fetching is in measure.ts.
 *
 * Errs one way only: a page Pulse can't read properly (a bot-protection
 * block, a menu built by script, a timeout) costs a fault, never invents one.
 * "We never get around a block."
 */
import type { Fault } from "./rules.ts";

export interface Tags {
  /** Google Ads conversion tags, AW-... */
  aw: string[];
  /** Meta Pixel ids. */
  metaPixel: string[];
  /** Google Analytics 4, G-... */
  ga4: string[];
  /** The old Universal Analytics, UA-... */
  ua: string[];
}

const uniq = (xs: string[]) => [...new Set(xs)].sort();

function all(re: RegExp, text: string, group = 0): string[] {
  return [...text.matchAll(re)].map((m) => m[group]);
}

/**
 * The tracking tags in a page's source and in the requests it made while
 * loading (PageSpeed's network list catches tags loaded through Tag Manager,
 * which never appear in the source).
 */
export function findTags(html: string, requestUrls: string[] = []): Tags {
  const urls = requestUrls.join("\n");
  const text = `${html}\n${urls}`;
  return {
    aw: uniq(all(/\bAW-[0-9]{6,12}\b/g, text)),
    metaPixel: uniq([
      ...all(/fbq\(\s*['"]init['"]\s*,\s*['"]([0-9]{10,20})['"]/g, html, 1),
      ...all(/facebook\.com\/tr\/?\?[^\s"'<>]*?\bid=([0-9]{10,20})/g, text, 1),
      ...all(/connect\.facebook\.net\/signals\/config\/([0-9]{10,20})/g, text, 1),
    ]),
    ga4: uniq(all(/\bG-[A-Z0-9]{8,12}\b/g, text)),
    ua: uniq(all(/\bUA-[0-9]{4,10}-[0-9]{1,4}\b/g, text)),
  };
}

/** Meta Pixel PageView requests during one load, by pixel id. */
export function pixelPageViews(requestUrls: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of requestUrls) {
    if (!/facebook\.com\/tr\/?\?/.test(u)) continue;
    const id = /[?&]id=([0-9]{10,20})/.exec(u)?.[1];
    const ev = /[?&]ev=([^&]+)/.exec(u)?.[1];
    if (id && ev && decodeURIComponent(ev) === "PageView") out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/** The text a person would see: no scripts, styles, comments or tags. */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Australian numbers as people write them: landline with area code, mobile,
// 1300/1800, 13 xx xx, and +61 forms. Spaces, dots, dashes and brackets allowed.
const PHONE =
  /(?:\+61[\s.-]?\(?0?\)?[\s.-]?[2-478](?:[\s.-]?[0-9]){8}|\(?0[2-478]\)?(?:[\s.-]?[0-9]){8}|1[38]00(?:[\s.-]?[0-9]){6}|\b13(?:[\s.-]?[0-9]){4}\b)/;

/** A phone number a person can read on the page, or null. */
export function phoneInHtml(html: string): string | null {
  return PHONE.exec(visibleText(html))?.[0]?.trim() ?? null;
}

/** Whether any link on the page dials a number. */
export function hasTelLink(html: string): boolean {
  return /href\s*=\s*["']?\s*tel:/i.test(html);
}

/**
 * A page whose content is built by script after it loads: next to no text in
 * the fetched HTML and an empty app root. Then a missing phone link may just
 * be a link not built yet, so that fault is skipped.
 */
export function looksScriptBuilt(html: string): boolean {
  const words = visibleText(html).split(" ").filter(Boolean).length;
  const root = /<div[^>]+id=["'](?:root|app|__next|__nuxt|___gatsby)["'][^>]*>\s*<\/div>/i.test(html);
  return words < 60 || (root && words < 200);
}

/**
 * A bot-protection or "are you human" page rather than the site. Pulse never
 * tries to get past one: it means "couldn't check". A 403 or 429 always counts.
 * Otherwise it takes a challenge marker AND an error status or a near-empty
 * page, because plenty of normal pages carry a reCAPTCHA or Cloudflare's
 * background script.
 */
export function isBlockPage(status: number, html: string): boolean {
  if (status === 403 || status === 429) return true;
  const marker =
    /cf-chl|cf_chl_opt|Just a moment\.\.\.|Attention Required! \| Cloudflare|Incapsula incident|_Incapsula_Resource|Sucuri WebSite Firewall|Access Denied[\s\S]{0,200}(akamai|reference #)|DDoS protection by|px-captcha|verify you are (a )?human|challenge-platform/i.test(
      html.slice(0, 50000),
    );
  if (!marker) return false;
  return status >= 400 || visibleText(html).split(" ").filter(Boolean).length < 80;
}

export interface MenuLink {
  url: string;
  label: string;
}

/**
 * The links in the site's main menu: anchors inside <nav> or <header>, on
 * the site's own host, without fragments, mail or phone links. A menu built
 * by script won't be in the HTML and is simply missed.
 */
export function menuLinks(html: string, pageUrl: string, max = 15): MenuLink[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const host = base.hostname.replace(/^www\./, "");
  let blocks = [...html.matchAll(/<(nav|header)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  // No <nav> or <header>: the stretch after the first few elements whose class
  // or id says nav or menu (common in older themes). A menu built by script
  // leaves these empty, and is simply missed.
  if (blocks.length === 0) {
    const lower = html.toLowerCase();
    blocks = [...html.matchAll(/<([a-z]+)\b[^>]*\b(?:class|id)\s*=\s*["'][^"']*\b(?:nav|navbar|navigation|menu|main-menu)\b[^"']*["'][^>]*>/gi)]
      .slice(0, 3)
      .map((m) => {
        // Only the element's own content, up to its first closing tag, so an
        // empty placeholder doesn't lend its neighbours' links to the menu.
        const start = (m.index ?? 0) + m[0].length;
        const end = lower.indexOf(`</${m[1].toLowerCase()}>`, start);
        return end === -1 ? "" : html.slice(start, Math.min(end, start + 8000));
      });
  }
  const out = new Map<string, MenuLink>();
  for (const block of blocks) {
    for (const m of block.matchAll(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = m[2].trim().replace(/&amp;/g, "&");
      if (!href || /^(#|mailto:|tel:|javascript:|sms:)/i.test(href)) continue;
      let u: URL;
      try {
        u = new URL(href, base);
      } catch {
        continue;
      }
      if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
      u.hash = "";
      if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?)$/i.test(u.pathname)) continue;
      const key = u.toString();
      if (!out.has(key)) out.set(key, { url: key, label: visibleText(m[3]).slice(0, 60) || u.pathname });
      if (out.size >= max) return [...out.values()];
    }
  }
  return [...out.values()];
}

export interface PsiSummary {
  ok: boolean;
  error?: string;
  fcpMs: number | null;
  lcpMs: number | null;
  finalUrl: string | null;
  requestUrls: string[];
  /** PageSpeed's phone screenshot, a data: URI. */
  screenshot: string | null;
}

/** The parts of a PageSpeed Insights v5 response Draper uses. */
export function summarisePsi(json: unknown): PsiSummary {
  const empty: PsiSummary = { ok: false, fcpMs: null, lcpMs: null, finalUrl: null, requestUrls: [], screenshot: null };
  const j = json as {
    error?: { message?: string };
    lighthouseResult?: {
      finalDisplayedUrl?: string;
      finalUrl?: string;
      runtimeError?: { code?: string; message?: string };
      audits?: Record<string, { numericValue?: number; details?: { data?: string; items?: { url?: string }[] } }>;
    };
  };
  if (!j || typeof j !== "object") return { ...empty, error: "PageSpeed gave no answer" };
  if (j.error) return { ...empty, error: j.error.message ?? "PageSpeed refused the request" };
  const lh = j.lighthouseResult;
  if (!lh) return { ...empty, error: "PageSpeed gave no Lighthouse result" };
  if (lh.runtimeError?.code && lh.runtimeError.code !== "NO_ERROR") {
    return { ...empty, error: lh.runtimeError.message ?? lh.runtimeError.code };
  }
  const a = lh.audits ?? {};
  const num = (k: string) => (typeof a[k]?.numericValue === "number" ? Math.round(a[k].numericValue!) : null);
  const fcpMs = num("first-contentful-paint");
  const lcpMs = num("largest-contentful-paint");
  return {
    ok: fcpMs !== null && lcpMs !== null,
    error: fcpMs === null || lcpMs === null ? "PageSpeed didn't report paint times" : undefined,
    fcpMs,
    lcpMs,
    finalUrl: lh.finalDisplayedUrl ?? lh.finalUrl ?? null,
    requestUrls: (a["network-requests"]?.details?.items ?? []).map((i) => i.url ?? "").filter(Boolean),
    screenshot: a["final-screenshot"]?.details?.data ?? null,
  };
}

/** The facts one measurement gathered, as the fault rules need them. */
export interface Facts {
  /** "blocked" or "failed" means the page couldn't be read: no faults. */
  status: "ok" | "blocked" | "failed";
  psiOk: boolean;
  fcpMs: number | null;
  lcpMs: number | null;
  /** The HTTPS fetch: loaded, failed on the certificate, refused, or couldn't tell. */
  https: "ok" | "bad_certificate" | "unreachable" | "unknown";
  /** The plain HTTP fetch loaded the site. */
  httpLoads: boolean;
  menu: { url: string; status: number | null; blocked: boolean }[];
  phoneInHtml: boolean;
  telLink: boolean;
  scriptBuilt: boolean;
  pixelPageViews: Record<string, number>;
  tags: Tags;
}

export const SLOW_FCP_MS = 4000;
export const SLOW_LCP_MS = 6000;

/** The ad signal: a Google Ads tag or a Meta Pixel. Needed to qualify at all. */
export function hasAdSignal(tags: Tags): boolean {
  return tags.aw.length > 0 || tags.metaPixel.length > 0;
}

/** The faults one measurement shows. Never a tracking fault that needs a form sent. */
export function faultsOf(f: Facts): Fault[] {
  if (f.status !== "ok") return [];
  const out: Fault[] = [];
  if (f.psiOk && ((f.fcpMs ?? 0) >= SLOW_FCP_MS || (f.lcpMs ?? 0) >= SLOW_LCP_MS)) out.push("slow_mobile");
  // A menu page answering with an error. A block page or no answer isn't one.
  if (f.menu.some((m) => !m.blocked && m.status !== null && (m.status === 404 || m.status === 410 || m.status >= 500))) {
    out.push("broken_page");
  }
  // HTTPS fails on its certificate, or won't load at all while plain HTTP does.
  if (f.https === "bad_certificate" || (f.https === "unreachable" && f.httpLoads)) out.push("not_secure");
  if (f.phoneInHtml && !f.telLink && !f.scriptBuilt) out.push("phone_not_tappable");
  if (Object.values(f.pixelPageViews).some((n) => n >= 2)) out.push("pixel_double");
  if (f.tags.ua.length > 0 && f.tags.ga4.length === 0) out.push("old_analytics");
  return out;
}

export const CONFIRM_GAP_MS = 60 * 60 * 1000;

/**
 * Faults that count: failing on two measurements at least an hour apart
 * (decision 3: Pulse re-measures them itself). Runs that couldn't read the
 * page are ignored, never counted for or against.
 */
export function confirmedFaults(runs: { measuredAt: string | Date; status: Facts["status"]; faults: Fault[] }[]): Fault[] {
  const ok = runs
    .filter((r) => r.status === "ok")
    .map((r) => ({ at: new Date(r.measuredAt).getTime(), faults: new Set(r.faults) }))
    .sort((a, b) => a.at - b.at);
  const out = new Set<Fault>();
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      if (ok[j].at - ok[i].at < CONFIRM_GAP_MS) continue;
      for (const f of ok[i].faults) if (ok[j].faults.has(f)) out.add(f);
    }
  }
  return [...out].sort();
}

/** A prospect qualifies with the ad signal and at least two faults: one per email. */
export function qualifies(adSignal: boolean, faults: Fault[]): boolean {
  return adSignal && new Set(faults).size >= 2;
}
