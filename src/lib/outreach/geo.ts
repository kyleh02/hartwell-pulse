/**
 * The client-area rule: a prospect offering an overlapping service within a
 * client's radius (15 km unless Kyle sets another) is skipped, so Draper never
 * pitches a client's competitor down the road. Pure, tested in geo.test.ts.
 *
 * Distance is between postcodes (GeoNames data, see data/au-postcodes.ts),
 * as the crow flies. Services overlap when they share a meaningful word, so
 * "reformer pilates" and "pilates studio" overlap and "marquee hire" and
 * "furniture hire" don't. A client area with no services listed covers every
 * kind of business in its radius. It errs towards skipping: near a client,
 * a missed prospect costs nothing and a pitched competitor costs a client.
 */
import { AU_POSTCODES } from "./data/au-postcodes.ts";

export interface Place {
  state: string;
  lat: number;
  lon: number;
}

let table: Map<string, Place> | null = null;

/** Where a postcode is, or null when it isn't an Australian postcode on file. */
export function postcodePlace(postcode: string | null | undefined): Place | null {
  if (!table) {
    table = new Map();
    for (const entry of AU_POSTCODES.split(";")) {
      const [pc, state, lat, lon] = entry.split(",");
      table.set(pc, { state, lat: Number(lat), lon: Number(lon) });
    }
  }
  const pc = (postcode ?? "").trim();
  return /^[0-9]{4}$/.test(pc) ? (table.get(pc) ?? null) : null;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Kilometres between two postcodes, or null if either isn't on file. */
export function postcodeDistanceKm(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = postcodePlace(a);
  const pb = postcodePlace(b);
  return pa && pb ? haversineKm(pa, pb) : null;
}

// Words that say nothing about which trade it is.
const GENERIC = new Set([
  "and", "or", "the", "of", "for", "a", "an", "in", "on", "at", "with", "to", "by",
  "service", "services", "studio", "studios", "hire", "hiring", "rental", "rentals",
  "repair", "repairs", "sales", "supply", "supplies", "shop", "store", "centre", "center",
  "company", "co", "pty", "ltd", "group", "australia", "local", "mobile", "custom",
  "professional", "specialist", "specialists", "business", "small", "new", "used",
]);

/** The meaningful words in a description, singular. */
export function serviceWords(texts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    for (const raw of (t ?? "").toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || GENERIC.has(raw)) continue;
      out.add(raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
    }
  }
  return out;
}

export interface ClientArea {
  label: string;
  postcode: string;
  services: string[];
  radiusKm: number;
}

export interface AreaBlock {
  label: string;
  km: number | null;
}

/**
 * The client areas a prospect falls inside, offering an overlapping service.
 * An unknown prospect postcode can't be measured, so it is blocked while any
 * client area exists.
 */
export function clientAreaBlocks(
  prospect: { postcode: string | null | undefined; services: (string | null | undefined)[] },
  areas: ClientArea[],
): AreaBlock[] {
  if (areas.length === 0) return [];
  if (!postcodePlace(prospect.postcode)) {
    return [{ label: `Postcode ${prospect.postcode || "missing"} isn't on file, so the distance to clients can't be checked`, km: null }];
  }
  const theirs = serviceWords(prospect.services);
  const blocks: AreaBlock[] = [];
  for (const a of areas) {
    const km = postcodeDistanceKm(prospect.postcode, a.postcode);
    if (km === null || km > a.radiusKm) continue;
    const ours = serviceWords(a.services);
    const overlap = ours.size === 0 || [...ours].some((w) => theirs.has(w));
    if (overlap) blocks.push({ label: `${a.label} (${Math.round(km)} km away)`, km });
  }
  return blocks;
}
