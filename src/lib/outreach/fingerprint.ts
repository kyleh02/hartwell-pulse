/**
 * The hash a fingerprint stores: SHA-256 of "kind:value", where value is a key
 * from normalise.ts. Only the hash is kept, so the fingerprint table blocks a
 * business without holding its details.
 *
 * DO NOT CHANGE THIS. Every fingerprint ever stored was made with it, and a
 * different hash would quietly match none of them. fingerprint.test.ts pins
 * a known value.
 */
import { createHash } from "node:crypto";
import type { Key } from "./normalise.ts";

export function hashKey(k: Key): string {
  return createHash("sha256").update(`${k.kind}:${k.value}`).digest("hex");
}
