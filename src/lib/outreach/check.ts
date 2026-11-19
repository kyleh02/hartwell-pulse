import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumn } from "@/lib/db-errors";
import { businessKeys, type Key } from "./normalise.ts";
import { hashKey } from "./fingerprint.ts";
import { matchBusiness, type Block, type FingerprintHit, type KnownRecord, type Verdict } from "./match.ts";
import { clientAreaBlocks, type ClientArea } from "./geo.ts";
import type { FingerprintKind, FingerprintReason } from "./rules.ts";

/**
 * Draper's no-repeat rule, part 3: reading what Pulse knows and checking a
 * business against it (the rules are in match.ts). Called when a prospect is
 * created, at submit and just before a send, so every caller passes the
 * service-role client after its own admin or token check: the answer has to
 * include leads and clients whoever is asking.
 *
 * It fails CLOSED. If anything can't be read, the business is not allowed.
 */

export interface CheckInput {
  domain?: string | null;
  website?: string | null;
  name?: string | null;
  abn?: string | null;
  email?: string | null;
  phone?: string | null;
  /**
   * Where they are and what they do, for the client-area radius. Without a
   * postcode the radius isn't checked, so every caller that has one (adding
   * a prospect, submit, before a send) must pass it.
   */
  postcode?: string | null;
  services?: (string | null | undefined)[];
}

const PAGE = 1000;

/** Every row of a table, a page at a time (PostgREST returns 1,000 at most). */
async function every<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(`${table}: ${error.message}`), { code: error.code });
    out.push(...((data as T[] | null) ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

type Row = Record<string, string | null>;

/** Do-not-contact, with the ABN and phone columns 0063 adds when they are there. */
async function doNotContact(db: SupabaseClient): Promise<Row[]> {
  try {
    return await every<Row>(db, "do_not_contact", "email, business, website, abn, phone");
  } catch (e) {
    if (!isMissingColumn(e as { code?: string })) throw e;
    return every<Row>(db, "do_not_contact", "email, business, website");
  }
}

/** Clients, with the ABN and legal name 0052 added when they are there. */
async function clients(db: SupabaseClient): Promise<Row[]> {
  try {
    return await every<Row>(db, "clients", "id, business_name, legal_name, abn");
  } catch (e) {
    if (!isMissingColumn(e as { code?: string })) throw e;
    return every<Row>(db, "clients", "id, business_name");
  }
}

/** Everything a business could be matched against, keyed. */
export async function knownRecords(db: SupabaseClient, exceptProspectId?: string): Promise<KnownRecord[]> {
  const [leads, clientRows, people, dnc, exclusions, prospects, contacts] = await Promise.all([
    every<Row>(db, "leads", "business, email, phone, website"),
    clients(db),
    every<Row>(db, "client_users", "client_id, email, role"),
    doNotContact(db),
    every<Row>(db, "outreach_exclusions", "business_name, domain, abn"),
    every<Row>(db, "outreach_prospects", "id, business_name, domain, abn, phone"),
    every<Row>(db, "outreach_contacts", "prospect_id, email"),
  ]);

  const known: KnownRecord[] = [];
  for (const l of leads) {
    known.push({
      source: "lead",
      label: `Lead: ${l.business || l.email || l.website || "unnamed"}`,
      keys: businessKeys({ name: l.business, email: l.email, phone: l.phone, website: l.website }),
    });
  }
  const emailsByClient = new Map<string, string[]>();
  for (const p of people) {
    if (p.role === "client" && p.client_id && p.email) {
      emailsByClient.set(p.client_id, [...(emailsByClient.get(p.client_id) ?? []), p.email]);
    }
  }
  for (const c of clientRows) {
    known.push({
      source: "client",
      label: `Client: ${c.business_name}`,
      keys: businessKeys({ name: [c.business_name, c.legal_name], abn: c.abn, email: emailsByClient.get(c.id ?? "") ?? [] }),
    });
  }
  for (const d of dnc) {
    known.push({
      source: "do_not_contact",
      label: `Do not contact: ${d.business || d.email || d.website || "unnamed"}`,
      keys: businessKeys({ name: d.business, email: d.email, website: d.website, abn: d.abn, phone: d.phone }),
    });
  }
  for (const x of exclusions) {
    known.push({
      source: "exclusion",
      label: `Exclusion: ${x.business_name || x.domain || x.abn}`,
      keys: businessKeys({ name: x.business_name, domain: x.domain, abn: x.abn }),
    });
  }
  const emailsByProspect = new Map<string, string[]>();
  for (const c of contacts) {
    if (c.prospect_id && c.email) {
      emailsByProspect.set(c.prospect_id, [...(emailsByProspect.get(c.prospect_id) ?? []), c.email]);
    }
  }
  for (const p of prospects) {
    if (p.id === exceptProspectId) continue;
    known.push({
      source: "prospect",
      label: `Prospect: ${p.business_name || p.domain || "purged"}`,
      keys: businessKeys({
        name: p.business_name,
        domain: p.domain,
        abn: p.abn,
        phone: p.phone,
        email: emailsByProspect.get(p.id ?? "") ?? [],
      }),
    });
  }
  return known;
}

/** Each client's areas, labelled with the client's name. */
export async function clientAreas(db: SupabaseClient): Promise<ClientArea[]> {
  const [areas, clientRows] = await Promise.all([
    every<{ client_id: string; place: string; postcode: string | null; services: string[]; radius_km: number }>(
      db,
      "outreach_client_areas",
      "client_id, place, postcode, services, radius_km",
    ),
    every<Row>(db, "clients", "id, business_name"),
  ]);
  const names = new Map(clientRows.map((c) => [c.id, c.business_name]));
  return areas.map((a) => ({
    label: `Client: ${names.get(a.client_id) ?? "unknown"}, ${a.place}`,
    postcode: a.postcode ?? "",
    services: a.services ?? [],
    radiusKm: Number(a.radius_km),
  }));
}

/** Fingerprints matching any of these keys. */
export async function fingerprintHits(db: SupabaseClient, keys: Key[]): Promise<FingerprintHit[]> {
  if (keys.length === 0) return [];
  const byHash = new Map(keys.map((k) => [hashKey(k), k.kind]));
  const { data, error } = await db
    .from("outreach_fingerprints")
    .select("kind, hash, reason")
    .in("hash", [...byHash.keys()]);
  if (error) throw new Error(`outreach_fingerprints: ${error.message}`);
  return ((data as { kind: FingerprintKind; hash: string; reason: FingerprintReason }[] | null) ?? [])
    .filter((r) => byHash.get(r.hash) === r.kind)
    .map((r) => ({ kind: r.kind, reason: r.reason }));
}

/**
 * Is this business allowed? Pass `exceptProspectId` when re-checking a
 * prospect that already exists, so it doesn't block itself.
 */
export async function checkBusiness(
  db: SupabaseClient,
  input: CheckInput,
  opts: { exceptProspectId?: string } = {},
): Promise<Verdict & { keys: Key[] }> {
  const keys = businessKeys(input);
  if (keys.length === 0) return { ...matchBusiness([], [], []), keys };
  try {
    const [known, hits, areas] = await Promise.all([
      knownRecords(db, opts.exceptProspectId),
      fingerprintHits(db, keys),
      input.postcode === undefined || input.postcode === null || input.postcode === ""
        ? Promise.resolve([] as ClientArea[])
        : clientAreas(db),
    ]);
    const v = matchBusiness(keys, known, hits);
    const near: Block[] = clientAreaBlocks({ postcode: input.postcode, services: input.services ?? [] }, areas).map(
      (b) => ({ source: "client_area", kind: "area", label: b.label }),
    );
    return { allowed: v.allowed && near.length === 0, blocks: [...v.blocks, ...near], problem: v.problem, keys };
  } catch (e) {
    return {
      allowed: false,
      blocks: [],
      problem: `Couldn't check, so not allowed: ${e instanceof Error ? e.message : String(e)}`,
      keys,
    };
  }
}

/**
 * Store fingerprints. Never changes one already there (the table refuses
 * that anyway): a key already on file is counted and left alone.
 */
export async function recordFingerprints(
  db: SupabaseClient,
  keys: Key[],
  reason: FingerprintReason,
  source: string,
): Promise<{ added: number; already: number }> {
  const rows = [...new Map(keys.map((k) => [`${k.kind}:${hashKey(k)}`, { kind: k.kind, hash: hashKey(k), reason, source }])).values()];
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data, error } = await db
      .from("outreach_fingerprints")
      .upsert(chunk, { onConflict: "kind,hash", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`Couldn't store fingerprints: ${error.message}`);
    added += data?.length ?? 0;
  }
  return { added, already: rows.length - added };
}
