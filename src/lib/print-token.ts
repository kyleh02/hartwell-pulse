import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived token letting the PDF renderer open one document.
 *
 * The renderer is a headless browser. It has no Clerk session and cannot get
 * one, so it cannot open the ordinary viewer, and the print page it opens
 * instead has to be reachable without a login. That page therefore has to
 * prove for itself that the request is ours, which is what this is for.
 *
 * Same shape as the share links: a signature rather than a guessable id, and
 * an expiry so a URL that leaks out of a log is useless within minutes.
 *
 * The KIND is signed alongside the id, so a token minted for a report cannot
 * be pointed at the invoice that happens to share its uuid space. That is not
 * a hypothetical worth dismissing: the two print routes are both public, and
 * the only thing standing between them and the world is what this signs.
 *
 * Signed with CRON_SECRET rather than a variable of its own. It is already
 * required, already server-only, and already the shared secret this deployment
 * uses to prove a request came from itself. One more environment variable that
 * silently disables a feature when unset is the worse trade.
 */

export type PrintKind = "report" | "invoice";

/** Long enough for a cold Chromium start, short enough to be worthless later. */
const TTL_MS = 5 * 60 * 1000;

function sign(kind: PrintKind, id: string, expiry: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${kind}.${id}.${expiry}`)
    .digest("hex");
}

export function printTokenFor(kind: PrintKind, id: string): string | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const expiry = Date.now() + TTL_MS;
  return `${expiry}.${sign(kind, id, expiry, secret)}`;
}

export function printTokenValid(
  kind: PrintKind,
  id: string,
  token: string | undefined,
): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !token) return false;

  const [expiryPart, given] = token.split(".");
  const expiry = Number(expiryPart);
  if (!Number.isFinite(expiry) || !given) return false;
  // Checked before the comparison, so an expired token costs nothing to reject.
  if (Date.now() > expiry) return false;

  const expected = sign(kind, id, expiry, secret);
  // Buffers of different lengths make timingSafeEqual throw rather than return
  // false, and a length mismatch is a wrong token anyway.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
