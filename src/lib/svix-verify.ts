import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Svix-signed webhook, which is what Resend sends.
 *
 * Written out rather than pulling in the svix package for one route. The
 * scheme is small and stable: HMAC-SHA256 over "id.timestamp.body", keyed on
 * the base64 body of the whsec_ secret, compared in constant time.
 *
 * The timestamp check is not decoration. Without it a signature stays valid
 * forever, and anyone who ever captures one request can replay it back at this
 * endpoint whenever they like.
 */
const TOLERANCE_SECONDS = 5 * 60;

export function verifySvix({
  secret,
  body,
  id,
  timestamp,
  signature,
  now = Date.now(),
}: {
  secret: string;
  body: string;
  id: string;
  timestamp: string;
  signature: string;
  now?: number;
}): boolean {
  if (!secret || !body || !id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest();

  // The header carries a space-separated list, each "v1,<base64>". More than
  // one appears while a secret is being rotated, and any match is a pass.
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    let given: Buffer;
    try {
      given = Buffer.from(value, "base64");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      return true;
    }
  }
  return false;
}
