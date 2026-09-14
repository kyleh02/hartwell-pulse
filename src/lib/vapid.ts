// Client-safe. Used by the server sender (lib/push.ts) and the browser
// subscriber (PushToggle), which must agree on the key byte for byte, so both
// clean it the same way.

export interface VapidKeyResult {
  /** URL-safe base64 with no padding, or null if the value cannot be used. */
  key: string | null;
  /** What had to be cleaned off, for the log. Never the key itself. */
  changes: string[];
  /** Why the value is unusable, when it is. */
  problem: string | null;
}

/**
 * Turn a VAPID key as it was pasted into an environment variable into the exact
 * form web-push accepts.
 *
 * web-push only takes URL-safe base64 with no "=", and rejects anything else
 * with one message that does not say what is wrong. Surrounding quotes, a
 * trailing space or line break, padding, and standard base64's "+" and "/" all
 * produce that same error, and every one of them is an encoding of the SAME key,
 * so cleaning them is not guessing. A key of the wrong length is a different
 * key, and is reported rather than repaired.
 *
 * This is how the production key failed: it was saved with extra characters on
 * 27 July, every notification send threw inside setVapidDetails, and because the
 * variable is write-only in Vercel nobody could see what was wrong with it.
 */
export function normaliseVapidKey(
  raw: string | undefined | null,
  expectedBytes: number,
): VapidKeyResult {
  const changes: string[] = [];
  if (!raw) return { key: null, changes, problem: "not set" };

  let k = raw;
  // An escaped line break copied out of a .env file arrives as the two
  // characters "\" and "n". That is not whitespace, so a trim leaves it.
  if (/\\[nr]/.test(k)) {
    k = k.replace(/\\[nr]/g, "");
    changes.push("escaped line break removed");
  }
  const trimmed = k.trim();
  if (trimmed !== k) {
    k = trimmed;
    changes.push("surrounding whitespace removed");
  }
  // [\s\S] rather than ".", which does not match a line break, so a line
  // break just inside the quotes cannot stop them being recognised.
  if (/^["'][\s\S]*["']$/.test(k)) {
    k = k.slice(1, -1).trim();
    changes.push("surrounding quotes removed");
  }
  if (/[+/]/.test(k)) {
    k = k.replace(/\+/g, "-").replace(/\//g, "_");
    changes.push("converted from standard base64");
  }
  if (/=+$/.test(k)) {
    k = k.replace(/=+$/, "");
    changes.push("padding removed");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(k)) {
    return { key: null, changes, problem: "contains characters that are not base64" };
  }
  // Unpadded base64 carries 3 bytes in every 4 characters.
  const bytes = Math.floor((k.length * 3) / 4);
  if (bytes !== expectedBytes) {
    return {
      key: null,
      changes,
      problem: `decodes to ${bytes} bytes, expected ${expectedBytes}`,
    };
  }
  return { key: k, changes, problem: null };
}

/** A VAPID public key is an uncompressed P-256 point. */
export const VAPID_PUBLIC_BYTES = 65;
/** A VAPID private key is a P-256 scalar. */
export const VAPID_PRIVATE_BYTES = 32;
