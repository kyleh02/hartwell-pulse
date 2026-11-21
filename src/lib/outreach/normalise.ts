/**
 * Draper's no-repeat rule, part 1: turning what a business is called and how
 * to reach it into keys that compare equal however they were written.
 *
 * "WWW.Catten.com.au/contact", "catten.com.au" and "sales@catten.com.au" all
 * give the domain key "catten.com.au". "Catten Industries Pty Ltd" and
 * "CATTEN INDUSTRIES" give the same name key. "+61 7 5555 1234" and
 * "(07) 5555 1234" give the same phone key.
 *
 * DO NOT CHANGE HOW A KEY IS MADE once fingerprints exist. Fingerprints store
 * only a hash of these keys, so a change here silently stops old fingerprints
 * matching, and a business that said no could be emailed again.
 * normalise.test.ts pins the outputs; extend the rules only by adding new
 * keys alongside the old ones, never by changing what an old input gives.
 *
 * Pure, no imports, so the test runner can load it.
 */

import type { FingerprintKind } from "./rules.ts";

export interface Key {
  kind: FingerprintKind;
  value: string;
}

/**
 * Webmail and ISP mail. "sam@gmail.com" says nothing about which business Sam
 * runs, so its domain is never a key: blocking gmail.com would block
 * everyone. The address itself still is.
 */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.com.au",
  "hotmail.com",
  "hotmail.com.au",
  "live.com",
  "live.com.au",
  "msn.com",
  "yahoo.com",
  "yahoo.com.au",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "gmx.com",
  "mail.com",
  "bigpond.com",
  "bigpond.net.au",
  "bigpond.com.au",
  "optusnet.com.au",
  "iinet.net.au",
  "westnet.com.au",
  "internode.on.net",
  "tpg.com.au",
  "dodo.com.au",
  "adam.com.au",
  "ozemail.com.au",
  "aapt.net.au",
  "people.net.au",
  "exetel.com.au",
]);

/**
 * Sites where the host alone doesn't say which business it is:
 * "facebook.com/catten" and "facebook.com/someoneelse" share a host. A link
 * to one of these is never a domain key.
 */
export const SHARED_HOSTS = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linkedin.com",
  "au.linkedin.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "tiktok.com",
  "google.com",
  "sites.google.com",
  "business.google.com",
  "maps.google.com",
  "goo.gl",
  "g.page",
  "linktr.ee",
  "yellowpages.com.au",
  "truelocal.com.au",
  "hipages.com.au",
  "oneflare.com.au",
  "gumtree.com.au",
  "localsearch.com.au",
  "yelp.com",
  "yelp.com.au",
  "abr.business.gov.au",
  "abn.business.gov.au",
]);

/** The bare host of a website, URL or email, or null when there isn't a usable one. */
export function normaliseHost(input: string | null | undefined): string | null {
  let s = (input ?? "").trim();
  if (!s) return null;
  // An email address: the part after the @.
  if (s.includes("@") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = s.slice(s.lastIndexOf("@") + 1);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let host: string;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.+$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  // A real public name: two labels or more, letters in the last one, no IPs.
  if (!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/.test(host)) return null;
  return host;
}

/** The domain key of a website or URL, or null for a shared host. */
export function normaliseDomain(input: string | null | undefined): string | null {
  const host = normaliseHost(input);
  if (!host || SHARED_HOSTS.has(host)) return null;
  return host;
}

/** The domain key of an email address, or null for webmail and ISP mail. */
export function emailDomain(email: string | null | undefined): string | null {
  const e = normaliseEmail(email);
  if (!e) return null;
  const host = normaliseHost(e.slice(e.indexOf("@") + 1));
  if (!host || FREE_MAIL_DOMAINS.has(host) || SHARED_HOSTS.has(host)) return null;
  return host;
}

/**
 * An email address as one key: lower case, no "+tag", and for Gmail no dots,
 * because Gmail delivers "s.a.m+x@gmail.com" to "sam@gmail.com".
 */
export function normaliseEmail(input: string | null | undefined): string | null {
  let s = (input ?? "").trim().toLowerCase();
  const angle = /<([^<>]+)>/.exec(s);
  if (angle) s = angle[1].trim();
  s = s.replace(/^mailto:/, "");
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(s);
  if (!m) return null;
  let [, local, domain] = m;
  domain = domain.replace(/\.+$/, "");
  if (!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/.test(domain)) return null;
  local = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  if (!local) return null;
  return `${local}@${domain}`;
}

/**
 * An address that can never receive mail: on a top-level name reserved for
 * testing and documentation (RFC 2606 and 6761: .invalid, .test, .example,
 * .localhost) or one of the example domains. The sample workshop uses one on
 * purpose; nothing live may ever be sent to one (Kyle, 21 Nov 2026).
 */
export function undeliverableAddress(email: string | null | undefined): boolean {
  const domain = (email ?? "").trim().toLowerCase().split("@")[1]?.replace(/\.+$/, "") ?? "";
  if (!domain) return true;
  if (/\.(invalid|test|example|localhost)$/.test(domain) || ["invalid", "test", "example", "localhost"].includes(domain)) return true;
  return /(^|\.)example\.(com|net|org)$/.test(domain);
}

/** An ABN passes the ATO's check-digit rule. Takes exactly eleven digits. */
export function isValidAbn(digits: string): boolean {
  if (!/^[0-9]{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const d = Number(digits[i]) - (i === 0 ? 1 : 0);
    sum += d * weights[i];
  }
  return sum % 89 === 0;
}

/** An ABN as eleven digits, or null when it isn't a valid one. */
export function normaliseAbn(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  return isValidAbn(digits) ? digits : null;
}

// Words that say what kind of company it is, not which one.
const LEGAL_WORDS = new Set([
  "pty",
  "ltd",
  "limited",
  "proprietary",
  "inc",
  "incorporated",
  "co",
  "company",
  "corp",
  "corporation",
  "llc",
  "plc",
]);

/**
 * A business name as one key: case, accents, punctuation, spacing, "&" and
 * legal words like "Pty Ltd" removed, and a leading "The". Exact match only,
 * so "Smith Engineering" never blocks "Smith Engineering Services".
 */
export function normaliseName(input: string | null | undefined): string | null {
  const words = (input ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words[0] === "the" && words.length > 1) words.shift();
  while (words.length > 1 && LEGAL_WORDS.has(words[words.length - 1])) words.pop();
  const key = words.filter((w) => !LEGAL_WORDS.has(w)).join("");
  return key.length >= 2 ? key : null;
}

/**
 * Every name a business goes by. "Smith Holdings Pty Ltd t/a Ute Trays Plus"
 * gives both names, so either one blocks it.
 */
export function namesOf(input: string | null | undefined): string[] {
  const parts = (input ?? "").split(/\s+(?:t\/a|t\/as|trading as|atf)\s+/i);
  return parts.map(normaliseName).filter((k): k is string => !!k);
}

/**
 * An Australian phone number as one key: ten digits with the area code, or a
 * 13 number. "+61 7 5555 1234", "07 5555 1234" and "(07) 5555-1234" are the
 * same key. An eight-digit number with no area code can't be told apart from
 * the same digits in another state, so it gives no key.
 */
export function normalisePhone(input: string | null | undefined): string | null {
  let d = (input ?? "").replace(/\D/g, "");
  if (d.startsWith("0011")) d = d.slice(4);
  if (d.startsWith("61") && (d.length === 11 || (d.length === 12 && d[2] === "0"))) {
    d = d[2] === "0" ? d.slice(2) : `0${d.slice(2)}`;
  }
  if (/^0[2-578][0-9]{8}$/.test(d)) return d;
  if (/^1[38]00[0-9]{6}$/.test(d)) return d;
  if (/^13[0-9]{4}$/.test(d)) return d;
  return null;
}

type Many = string | null | undefined | (string | null | undefined)[];
const list = (v: Many) => (Array.isArray(v) ? v : [v]);

/** Every key a business gives, deduplicated. */
export function businessKeys(input: {
  domain?: Many;
  website?: Many;
  email?: Many;
  abn?: Many;
  name?: Many;
  phone?: Many;
}): Key[] {
  const out = new Map<string, Key>();
  const add = (kind: FingerprintKind, value: string | null) => {
    if (value) out.set(`${kind}:${value}`, { kind, value });
  };
  for (const d of [...list(input.domain), ...list(input.website)]) add("domain", normaliseDomain(d));
  for (const e of list(input.email)) {
    add("email", normaliseEmail(e));
    add("domain", emailDomain(e));
  }
  for (const a of list(input.abn)) add("abn", normaliseAbn(a));
  for (const n of list(input.name)) for (const k of namesOf(n)) add("name", k);
  for (const p of list(input.phone)) add("phone", normalisePhone(p));
  return [...out.values()];
}
