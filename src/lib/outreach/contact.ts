/**
 * The contact rule: the address must be published on the business's own site,
 * on the page Claude says, with no "no marketing" note near it. Pulse fetches
 * that page again at submit (submit.ts) and reads it with these. Pure.
 */
import { normaliseEmail, normaliseHost } from "./normalise.ts";
import { visibleText } from "./measure-rules.ts";

/** HTML entities that hide an @ or a dot, and the rest of the common ones. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&");
}

const NO_MARKETING =
  /\bno (marketing|unsolicited|solicitations?|spam|sales (calls|emails?)|cold (calls|emails?))\b|\bnot for (marketing|solicitation|sales)\b|\b(do not|don't|please don't|please do not) (send|use)[^.]{0,40}\b(marketing|promotional|unsolicited|sales)\b|\bunsolicited (emails?|offers|marketing)\b/i;

/**
 * Is this address on the page, and is there a "no marketing" note within a
 * few lines of it? Found as text or in a mailto: link; an address written as
 * "info [at] ..." is not found, which refuses the draft (the safe way).
 */
export function addressOnPage(html: string, email: string): { found: boolean; noMarketingNearby: boolean } {
  const want = normaliseEmail(email);
  if (!want) return { found: false, noMarketingNearby: false };
  const decoded = decodeEntities(html);
  const text = visibleText(decoded).toLowerCase();
  const inText = text.indexOf(email.trim().toLowerCase());
  const inLink = new RegExp(`mailto:\\s*${email.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(decoded);
  if (inText < 0 && !inLink) return { found: false, noMarketingNearby: false };
  // Near it: 300 characters either side in the visible text, or the whole
  // visible text when the address is only in a link.
  const around = inText >= 0 ? text.slice(Math.max(0, inText - 300), inText + email.length + 300) : text;
  return { found: true, noMarketingNearby: NO_MARKETING.test(around) };
}

/** The page is on the business's own site: the same domain or one of its subdomains. */
export function onOwnSite(pageUrl: string, domain: string): boolean {
  const host = normaliseHost(pageUrl);
  const own = normaliseHost(domain);
  return !!host && !!own && (host === own || host.endsWith(`.${own}`));
}
