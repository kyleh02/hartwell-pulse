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
  /** Cumulative layout shift, unitless (0.25 or more is Google's "poor"). */
  cls: number | null;
  /** Total blocking time in ms (600 or more is Google's "poor" on a phone). */
  tbtMs: number | null;
  finalUrl: string | null;
  requestUrls: string[];
  /** PageSpeed's phone screenshot, a data: URI. */
  screenshot: string | null;
}

/** The parts of a PageSpeed Insights v5 response Draper uses. */
export function summarisePsi(json: unknown): PsiSummary {
  const empty: PsiSummary = { ok: false, fcpMs: null, lcpMs: null, cls: null, tbtMs: null, finalUrl: null, requestUrls: [], screenshot: null };
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
  const clsRaw = a["cumulative-layout-shift"]?.numericValue;
  return {
    ok: fcpMs !== null && lcpMs !== null,
    error: fcpMs === null || lcpMs === null ? "PageSpeed didn't report paint times" : undefined,
    fcpMs,
    lcpMs,
    // Kept to three places: it's a small decimal, and rounding it whole would lose it.
    cls: typeof clsRaw === "number" ? Math.round(clsRaw * 1000) / 1000 : null,
    tbtMs: num("total-blocking-time"),
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
  /** 0067: Google's layout shift and blocking time, and whether the page is set up for phones (null: couldn't tell). */
  cls?: number | null;
  tbtMs?: number | null;
  mobileViewport?: boolean | null;
  /** 0071: what measures the site's ads, from the page, its tag manager containers and the phone test's requests. */
  tracking?: TrackingFacts | null;
}

// ---------- 0071: the tracking gaps (Kyle, 27 November 2026) ----------

export type SiteKind = "shopify" | "wix" | "squarespace" | "wordpress" | "duda" | "webflow" | "other";

/** What the site is built on, from its own markers. Only used to word the fix. */
export function siteKind(html: string): SiteKind {
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(html)) return "shopify";
  if (/static\.wixstatic\.com|wix-bolt|wixstatic|_wixCIDX|X-Wix-/i.test(html)) return "wix";
  if (/static1\.squarespace\.com|SQUARESPACE_CONTEXT|squarespace-cdn\.com/i.test(html)) return "squarespace";
  if (/multiscreensite\.com|dmAlbum|data-duda|duda_website/i.test(html)) return "duda";
  if (/assets\.website-files\.com|data-wf-page|data-wf-site/i.test(html)) return "webflow";
  if (/\/wp-content\/|\/wp-includes\/|\/wp-json\//i.test(html)) return "wordpress";
  return "other";
}

/** Google Tag Manager containers the page loads, from its source and the phone test's requests. */
export function gtmIds(html: string, requestUrls: string[] = []): string[] {
  return uniq(all(/\bGTM-[A-Z0-9]{4,9}\b/g, `${html}\n${requestUrls.join("\n")}`));
}

export interface GtmReading {
  id: string;
  /** The container's script was fetched and looks like a container. */
  ok: boolean;
  /** It has no tags at all. */
  empty: boolean;
  metaPixel: boolean;
  /** Any Google measurement tag: the Google tag, Analytics, Ads conversion or remarketing, or the old Universal Analytics. */
  googleTag: boolean;
  ga4: string[];
  aw: string[];
}

/**
 * Pulse's reading of a tag manager container (the public gtm.js any browser
 * loads). A Meta Pixel in it shows as Meta's script address or an fbq call,
 * whether in a custom HTML tag or a template; Google's tags by their own
 * function names. A script that isn't a container is "not ok": can't tell.
 */
export function readGtmContainer(id: string, js: string): GtmReading {
  const ok = /"resource"\s*:/.test(js) && /"tags"\s*:\s*\[/.test(js);
  const empty = /"tags"\s*:\s*\[\s*\]/.test(js);
  return {
    id,
    ok,
    empty: ok && empty,
    metaPixel: /fbevents|connect\.facebook\.net|fbq\(|facebook\.com\\?\/tr/i.test(js),
    googleTag: /"function"\s*:\s*"__(googtag|gaawc|gaawe|awct|sp|ua|gas)"/.test(js) || /\b(G-[A-Z0-9]{8,12}|AW-[0-9]{6,12})\b/.test(js),
    ga4: uniq(all(/\bG-[A-Z0-9]{8,12}\b/g, js)),
    aw: uniq(all(/\bAW-[0-9]{6,12}\b/g, js)),
  };
}

/** Shopify's own pixel settings name a Meta Pixel (its Facebook and Instagram app adds it at run time). */
export function shopifyMetaPixel(html: string): boolean {
  return /webPixelsConfigList[\s\S]{0,20000}?pixel_type\\*"\s*:\s*\\*"facebook_pixel/.test(html);
}

/**
 * A consent banner tool actually loaded on the page, which can hold tags back
 * until someone clicks: then a missing tag can't be told. Matched by the
 * tool's own script address, not its name: Duda sites and pixel plugins
 * mention Cookiebot in settings without loading it (found 27 November 2026).
 */
export function hasConsentTool(html: string, requestUrls: string[] = []): boolean {
  return /consent\.cookiebot\.(com|eu)|id=["']Cookiebot["']|cdn-cookieyes\.com|\/plugins\/cookie-law-info\/|cdn\.cookielaw\.org|optanon\.blob\.core|otSDKStub|app\.termly\.io|cdn\.iubenda\.com|\/plugins\/complianz-gdpr\/|cmplz-cookiebanner|app\.usercentrics\.eu|web\.cmp\.usercentrics|cmp\.quantcast\.com|quantcast\.mgr\.consensu\.org|cmp\.osano\.com|consent\.cookiefirst\.com|cdn\.cookie-script\.com|cdn\.consentmanager\.net|sdk\.privacy-center\.org|consent\.trustarc\.com|\/plugins\/borlabs-cookie\/|static\.axept\.io|cookiehub\.net\/|cc\.cdn\.civiccomputing\.com|\/plugins\/gdpr-cookie-consent\/|\/plugins\/cookie-notice\/|cdn\.enzuzo\.com|cdn\.termsfeed\.com/i.test(
    `${html.slice(0, 600_000)}\n${requestUrls.join("\n")}`,
  );
}

/** Any sign of a Meta Pixel in the page or the requests it made. */
export function metaPixelSeen(html: string, requestUrls: string[] = []): boolean {
  return /connect\.facebook\.net\/[a-zA-Z_]+\/fbevents\.js|connect\.facebook\.net\/signals|fbq\(|facebook\.com\/tr[/?]/.test(`${html}\n${requestUrls.join("\n")}`);
}

/** Any sign of a Google tag (Ads, Analytics old or new, the Google tag) in the page or its requests. */
export function googleTagSeen(html: string, requestUrls: string[] = []): boolean {
  const text = `${html}\n${requestUrls.join("\n")}`;
  return (
    /googletagmanager\.com\/gtag\/js|google-analytics\.com|googleadservices\.com\/pagead\/conversion|googleads\.g\.doubleclick\.net\/pagead|gtag\(\s*['"]config/.test(text) ||
    /\b(G-[A-Z0-9]{8,12}|GT-[A-Z0-9]{6,12}|AW-[0-9]{6,12}|UA-[0-9]{4,10}-[0-9]{1,4})\b/.test(text)
  );
}

export interface TrackingFacts {
  siteKind: SiteKind;
  /** Tag manager containers on the page. */
  gtm: string[];
  /** Every container was read. False when one couldn't be: then nothing about tracking is claimed. */
  gtmRead: boolean;
  /** There's a tag manager and every container in it is empty. */
  gtmEmpty: boolean;
  metaSeen: boolean;
  googleSeen: boolean;
  consent: boolean;
}

/** The tracking facts of one page, from its source, its containers and the phone test's requests. */
export function trackingFacts(html: string, requestUrls: string[], containers: GtmReading[]): TrackingFacts {
  const ids = gtmIds(html, requestUrls);
  const read = ids.every((id) => containers.some((c) => c.id === id && c.ok));
  return {
    siteKind: siteKind(html),
    gtm: ids,
    gtmRead: read,
    gtmEmpty: ids.length > 0 && read && containers.filter((c) => ids.includes(c.id)).every((c) => c.empty),
    metaSeen: metaPixelSeen(html, requestUrls) || shopifyMetaPixel(html) || containers.some((c) => c.ok && c.metaPixel),
    googleSeen: googleTagSeen(html, requestUrls) || containers.some((c) => c.ok && c.googleTag),
    consent: hasConsentTool(html, requestUrls),
  };
}

/** A page's tags with what its tag manager containers hold added in. */
export function withContainerTags(tags: Tags, containers: GtmReading[]): Tags {
  const ok = containers.filter((c) => c.ok);
  return {
    ...tags,
    ga4: uniq([...tags.ga4, ...ok.flatMap((c) => c.ga4)]),
    aw: uniq([...tags.aw, ...ok.flatMap((c) => c.aw)]),
  };
}

/**
 * Whether the tracking facts are good enough to say a tag is missing: the
 * page read properly, Google's phone test ran it (so a tag added by script,
 * by Wix or Squarespace, or by a container would have shown in its requests),
 * every container was read, and no consent banner can be holding tags back.
 * Errs one way only: when in doubt, no claim.
 */
export function canTellTracking(f: Pick<Facts, "status" | "psiOk" | "tracking">): boolean {
  const t = f.tracking;
  return f.status === "ok" && f.psiOk && !!t && t.gtmRead && !t.consent;
}

export const SLOW_FCP_MS = 4000;
export const SLOW_LCP_MS = 6000;
/** Google's "poor" lines for a phone. */
export const POOR_CLS = 0.25;
export const POOR_TBT_MS = 600;

/**
 * Whether the page tells a phone to lay it out at the phone's width: a
 * viewport meta tag with width=device-width. Without one, a phone shows the
 * desktop page shrunk to fit and the customer pinches and zooms.
 */
export function hasMobileViewport(html: string): boolean {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\bname\s*=\s*["']?viewport\b/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2] ?? "";
    if (/width\s*=\s*device-width/i.test(content)) return true;
  }
  return false;
}

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
  // 0067. From the same phone test: the page jumps about while it loads, or
  // can't respond for a stretch after it shows. And from the HTML itself:
  // no phone layout at all. A page built by script is left alone.
  if (f.psiOk && (f.cls ?? 0) >= POOR_CLS) out.push("layout_shift");
  if (f.psiOk && (f.tbtMs ?? 0) >= POOR_TBT_MS) out.push("page_freezes");
  if (f.mobileViewport === false && !f.scriptBuilt) out.push("no_mobile_layout");
  // 0071. No Meta Pixel anywhere, or no Google tag of any kind (an old
  // Universal Analytics tag is old_analytics instead), when Pulse can tell.
  if (canTellTracking(f)) {
    if (!f.tracking!.metaSeen && f.tags.metaPixel.length === 0) out.push("no_meta_pixel");
    if (!f.tracking!.googleSeen && f.tags.aw.length === 0 && f.tags.ga4.length === 0 && f.tags.ua.length === 0) out.push("no_google_tag");
  }
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
