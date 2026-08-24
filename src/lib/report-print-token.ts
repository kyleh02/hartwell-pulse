import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived token letting the PDF renderer open one report.
 *
 * The renderer is a headless browser. It has no Clerk session and cannot get
 * one, so it cannot open the ordinary viewer, and the print page it opens
 * instead has to be reachable without a login. That page therefore has to
 * prove for itself that the request is ours, which is what this is for.
 *
 * Same shape as the share links: a signature rather than a guessable id, and
 * an expiry so a URL that leaks out of a log is useless within minutes. It is
 * scoped to a single report id, so a token for one client's report cannot be
 * pointed at another's.
 *
 * Signed with CRON_SECRET rather than a new variable of its own. It is already
 * required, already server-only, already the shared secret this deployment
 * uses to prove a request came from itself, and one more environment variable
 * that silently disables a feature when unset is a worse trade than reusing
 * one that is definitely there.
 */

/** Long enough for a cold Chromium start, short enough to be worthless later. */
const TTL_MS = 5 * 60 * 1000;

function sign(reportId: string, expiry: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${reportId}.${expiry}`)
    .digest("hex");
}

export function printTokenFor(reportId: string): string | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const expiry = Date.now() + TTL_MS;
  return `${expiry}.${sign(reportId, expiry, secret)}`;
}

export function printTokenValid(reportId: string, token: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !token) return false;

  const [expiryPart, given] = token.split(".");
  const expiry = Number(expiryPart);
  if (!Number.isFinite(expiry) || !given) return false;
  // Checked before the comparison, so an expired token costs nothing to reject.
  if (Date.now() > expiry) return false;

  const expected = sign(reportId, expiry, secret);
  // Buffers of different lengths make timingSafeEqual throw rather than return
  // false, and a length mismatch is a wrong token anyway.
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
