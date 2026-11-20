/**
 * The Gmail refresh token is stored sealed (decision 5): AES-256-GCM under
 * OUTREACH_TOKEN_KEY, 32 random bytes in base64 that Kyle makes and keeps in
 * Vercel. A copy of the database alone is not a key to kyle@'s mailbox, and
 * a tampered value fails to open rather than opening wrong. Tested in
 * crypto.test.ts.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** The key from the environment, or null when it is missing or not 32 bytes. */
export function tokenKey(value = process.env.OUTREACH_TOKEN_KEY): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value.trim(), "base64");
  return key.length === 32 ? key : null;
}

/** base64 of iv (12 bytes) + ciphertext + tag (16 bytes). */
export function sealToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
}

/** Opens a sealed token. Throws if the key is wrong or the value was altered. */
export function openToken(sealed: string, key: Buffer): string {
  const raw = Buffer.from(sealed, "base64");
  if (raw.length < 12 + 16 + 1) throw new Error("The stored token is too short to be a sealed token");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
}
