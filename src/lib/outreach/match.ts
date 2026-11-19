/**
 * Draper's no-repeat rule, part 2: does a business match anything Pulse
 * already knows? Pure, so every kind of block can be tested.
 *
 * One business gets one approach, ever. A candidate is blocked when ANY of its
 * keys (domain, ABN, name, email, phone) matches:
 *   - a fingerprint: every business ever contacted or ever asking not to be;
 *   - the pipeline: a lead, or a client;
 *   - do-not-contact;
 *   - Kyle's private exclusions;
 *   - another prospect.
 * So a "no" from one address blocks its whole business: the address's domain,
 * and the business name on the do-not-contact entry, are keys as well.
 */
import type { FingerprintKind, FingerprintReason } from "./rules.ts";
import type { Key } from "./normalise.ts";

export type BlockSource =
  | "fingerprint"
  | "lead"
  | "client"
  | "do_not_contact"
  | "exclusion"
  | "prospect"
  | "client_area";

/** Kyle's private lists. A connector is never told when one of these matched. */
const PRIVATE: BlockSource[] = ["exclusion", "client_area"];

export interface Block {
  source: BlockSource;
  /** Which key matched, or "area" for the client-area radius (geo.ts). */
  kind: FingerprintKind | "area";
  /** Who or what it matched, for Kyle's eyes only. */
  label: string;
}

export interface Verdict {
  allowed: boolean;
  blocks: Block[];
  /** Set when the business couldn't be checked at all. Never allowed then. */
  problem?: string;
}

/** Something Pulse already knows about, with its keys worked out. */
export interface KnownRecord {
  source: Exclude<BlockSource, "fingerprint" | "client_area">;
  label: string;
  keys: Key[];
}

export interface FingerprintHit {
  kind: FingerprintKind;
  reason: FingerprintReason;
}

const FINGERPRINT_LABEL: Record<FingerprintReason, string> = {
  contacted: "Contacted before",
  opted_out: "Opted out",
  imported: "On an imported contact list",
  do_not_contact: "Asked not to be contacted",
};

/**
 * The verdict for a candidate. With no keys at all there is nothing to check
 * against, and an unchecked business is never allowed.
 */
export function matchBusiness(
  candidate: Key[],
  known: KnownRecord[],
  fingerprints: FingerprintHit[],
): Verdict {
  if (candidate.length === 0) {
    return { allowed: false, blocks: [], problem: "No usable domain, email, ABN, name or phone to check" };
  }
  const want = new Set(candidate.map((k) => `${k.kind}:${k.value}`));
  const blocks: Block[] = [];
  const seen = new Set<string>();
  const push = (b: Block) => {
    const id = `${b.source}:${b.kind}:${b.label}`;
    if (!seen.has(id)) {
      seen.add(id);
      blocks.push(b);
    }
  };
  for (const f of fingerprints) {
    push({ source: "fingerprint", kind: f.kind, label: FINGERPRINT_LABEL[f.reason] });
  }
  for (const r of known) {
    for (const k of r.keys) {
      if (want.has(`${k.kind}:${k.value}`)) push({ source: r.source, kind: k.kind, label: r.label });
    }
  }
  return { allowed: blocks.length === 0, blocks };
}

const PUBLIC_REASON: Record<Exclude<BlockSource, "exclusion" | "client_area">, string> = {
  fingerprint: "contacted before, or asked not to be",
  lead: "already in the pipeline",
  client: "a current or past client",
  do_not_contact: "asked not to be contacted",
  prospect: "already a prospect",
};

/**
 * What the morning run's connector may be told: allowed or blocked, and why,
 * EXCEPT that a match on Kyle's private lists (exclusions, client areas) gives
 * no reason at all, so they can't be learnt by probing. No names, ever.
 */
export function publicVerdict(v: Verdict): { allowed: boolean; reasons: string[] } {
  if (v.allowed) return { allowed: true, reasons: [] };
  if (v.problem) return { allowed: false, reasons: [v.problem] };
  if (v.blocks.some((b) => PRIVATE.includes(b.source))) return { allowed: false, reasons: [] };
  const reasons = [
    ...new Set(v.blocks.map((b) => PUBLIC_REASON[b.source as Exclude<BlockSource, "exclusion" | "client_area">])),
  ];
  return { allowed: false, reasons };
}
