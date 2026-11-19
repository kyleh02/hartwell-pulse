/**
 * Draper's measuring tool, the fetching (Stage 3). measureSite(url) runs, side
 * by side so it fits a 60-second route:
 *   - PageSpeed Insights, mobile (with PAGESPEED_API_KEY when it is set);
 *   - a plain fetch of the site over HTTPS and over HTTP;
 *   - each link in the main menu (up to 12).
 * It identifies itself honestly and never tries to get past a block: a
 * bot-protection page is "couldn't check". The rules are in measure-rules.ts.
 *
 * No server-only import and no database here, so a measurement can be run
 * from a script as well as a route. Storing one is store.ts.
 */
import {
  faultsOf,
  findTags,
  hasAdSignal,
  hasTelLink,
  isBlockPage,
  looksScriptBuilt,
  menuLinks,
  phoneInHtml,
  pixelPageViews,
  summarisePsi,
  type Facts,
  type PsiSummary,
  type Tags,
} from "./measure-rules.ts";
import type { Fault } from "./rules.ts";
import { setDefaultResultOrder } from "node:dns";

// Try IPv4 first. Where IPv6 has no route (a serverless box, or Kyle's PC),
// fetch otherwise spends its whole connect timeout on an IPv6 address and a
// site that loads fine reads as down.
setDefaultResultOrder("ipv4first");

export const USER_AGENT = "Mozilla/5.0 (compatible; HartwellPulse/1.0; +https://hartwelldigital.com)";

const PAGE_TIMEOUT_MS = 15_000;
const LINK_TIMEOUT_MS = 8_000;
const PSI_TIMEOUT_MS = 50_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_MENU_LINKS = 12;

export interface FetchResult {
  url: string;
  finalUrl: string | null;
  status: number | null;
  html: string;
  /** Node's error code when there was no response at all. */
  errorCode: string | null;
  error: string | null;
}

/** Reads at most `limit` bytes of a body, so a huge page can't stall a measurement. */
async function readCapped(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

export async function fetchPage(url: string, opts: { timeoutMs?: number; body?: boolean } = {}): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
    });
    const html = opts.body === false ? (await res.body?.cancel().catch(() => {}), "") : await readCapped(res, MAX_HTML_BYTES);
    return { url, finalUrl: res.url || url, status: res.status, html, errorCode: null, error: null };
  } catch (e) {
    const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
    const code = err.name === "AbortError" ? "TIMEOUT" : (err.cause?.code ?? err.code ?? err.name ?? "ERROR");
    return { url, finalUrl: null, status: null, html: "", errorCode: code, error: err.cause?.message ?? err.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** A page fetch, tried a second time if the connection itself timed out. */
async function fetchOnce(url: string): Promise<FetchResult> {
  const first = await fetchPage(url, { timeoutMs: 10_000 });
  if (first.status !== null || !/CONNECT_TIMEOUT|TIMEOUT/.test(first.errorCode ?? "")) return first;
  return fetchPage(url, { timeoutMs: 10_000 });
}

const CERT_ERROR =/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ALTNAME|DEPTH_ZERO|HOSTNAME_MISMATCH/i;
const UNREACHABLE = /ECONNREFUSED|EPROTO|ERR_SSL|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET/i;

/** How the HTTPS fetch went, in the terms the not-secure rule uses. */
export function httpsOutcome(r: FetchResult): Facts["https"] {
  if (r.status !== null) return "ok";
  const text = `${r.errorCode ?? ""} ${r.error ?? ""}`;
  if (CERT_ERROR.test(text)) return "bad_certificate";
  if (UNREACHABLE.test(text)) return "unreachable";
  return "unknown";
}

export async function runPageSpeed(url: string, key = process.env.PAGESPEED_API_KEY): Promise<PsiSummary> {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  if (key) q.set("key", key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PSI_TIMEOUT_MS);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: ctrl.signal });
    return summarisePsi(await res.json());
  } catch (e) {
    const timedOut = (e as { name?: string }).name === "AbortError";
    return summarisePsi({ error: { message: timedOut ? "PageSpeed took too long" : `PageSpeed failed: ${String(e)}` } });
  } finally {
    clearTimeout(timer);
  }
}

/** Checks links a few at a time, without downloading their bodies. */
async function checkLinks(links: { url: string; label: string }[]) {
  const out: { url: string; label: string; status: number | null; blocked: boolean }[] = [];
  for (let i = 0; i < links.length; i += 6) {
    const batch = await Promise.all(
      links.slice(i, i + 6).map(async (l) => {
        const r = await fetchPage(l.url, { timeoutMs: LINK_TIMEOUT_MS, body: false });
        return { ...l, status: r.status, blocked: r.status === 403 || r.status === 429 };
      }),
    );
    out.push(...batch);
  }
  return out;
}

export interface Measurement {
  url: string;
  finalUrl: string | null;
  status: Facts["status"];
  measuredAt: string;
  error: string | null;
  psi: Omit<PsiSummary, "screenshot" | "requestUrls"> & { requests: number };
  httpStatus: number | null;
  httpsStatus: number | null;
  https: Facts["https"];
  httpLoads: boolean;
  menu: { url: string; label: string; status: number | null; blocked: boolean }[];
  tags: Tags;
  pixelPageViews: Record<string, number>;
  phone: string | null;
  telLink: boolean;
  scriptBuilt: boolean;
  adSignal: boolean;
  faults: Fault[];
  /** PageSpeed's phone screenshot as a data: URI. */
  screenshot: string | null;
  /** What gets stored as the raw record (PageSpeed's request list, capped). */
  raw: Record<string, unknown>;
}

/** The address to measure, as https://host/path. Null when it isn't a web address. */
export function siteUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/\./.test(u.hostname)) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Measure one page. Never throws: a page that can't be read comes back as status "blocked" or "failed". */
export async function measureSite(input: string): Promise<Measurement> {
  const measuredAt = new Date().toISOString();
  const url = siteUrl(input);
  if (!url) throw new Error("That isn't a web address.");
  const u = new URL(url);
  const httpUrl = `http://${u.host}${u.pathname}${u.search}`;

  const psiP = runPageSpeed(url);
  // One after the other, not side by side: some servers drop a second
  // connection from the same address while the first is open, and that
  // would read as the site being down. PageSpeed is the long pole anyway.
  const https = await fetchOnce(url);
  const http = await fetchOnce(httpUrl);
  const httpsState = httpsOutcome(https);
  const httpLoads = http.status !== null && http.status < 400;

  // The page to read: HTTPS if it answered properly, else HTTP.
  const page = https.status !== null && https.status < 400 ? https : http;
  const blocked = page.status !== null && isBlockPage(page.status, page.html);
  const readable = page.status !== null && page.status < 400 && !blocked;

  const links = readable ? menuLinks(page.html, page.finalUrl ?? url, MAX_MENU_LINKS) : [];
  const [psi, menu] = await Promise.all([psiP, checkLinks(links)]);

  const tags = findTags(page.html, psi.requestUrls);
  const views = pixelPageViews(psi.requestUrls);
  const phone = readable ? phoneInHtml(page.html) : null;
  const telLink = hasTelLink(page.html);
  const scriptBuilt = readable ? looksScriptBuilt(page.html) : false;
  const status: Facts["status"] = blocked ? "blocked" : readable ? "ok" : "failed";

  const facts: Facts = {
    status,
    psiOk: psi.ok,
    fcpMs: psi.fcpMs,
    lcpMs: psi.lcpMs,
    https: httpsState,
    httpLoads,
    menu,
    phoneInHtml: !!phone,
    telLink,
    scriptBuilt,
    pixelPageViews: views,
    tags,
  };

  const error =
    status === "blocked"
      ? "The site showed a bot-protection page, so it couldn't be checked"
      : status === "failed"
        ? `The page didn't load: ${page.error ?? `status ${page.status}`}`
        : psi.ok
          ? null
          : `Speed not measured: ${psi.error}`;

  return {
    url,
    finalUrl: page.finalUrl,
    status,
    measuredAt,
    error,
    psi: { ok: psi.ok, error: psi.error, fcpMs: psi.fcpMs, lcpMs: psi.lcpMs, finalUrl: psi.finalUrl, requests: psi.requestUrls.length },
    httpStatus: http.status,
    httpsStatus: https.status,
    https: httpsState,
    httpLoads,
    menu,
    tags,
    pixelPageViews: views,
    phone,
    telLink,
    scriptBuilt,
    adSignal: hasAdSignal(tags),
    faults: faultsOf(facts),
    screenshot: psi.screenshot,
    raw: {
      https: { status: https.status, finalUrl: https.finalUrl, errorCode: https.errorCode, error: https.error },
      http: { status: http.status, finalUrl: http.finalUrl, errorCode: http.errorCode, error: http.error },
      psi: { ok: psi.ok, error: psi.error, fcpMs: psi.fcpMs, lcpMs: psi.lcpMs, finalUrl: psi.finalUrl },
      requestUrls: psi.requestUrls.slice(0, 400),
    },
  };
}
