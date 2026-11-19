/**
 * ABN checks through the ABR's own web service (decision 6). Needs a free GUID
 * Kyle registers for at abr.business.gov.au, in Vercel as ABR_GUID. Without
 * it nothing is fetched and the ABN stays "unchecked", recorded as Claude's
 * reading of the public ABN Lookup site rather than Pulse's own check.
 *
 * The parsing is pure and tested in abr.test.ts.
 */
import { normaliseAbn, normaliseName } from "./normalise.ts";

export interface AbnRecord {
  abn: string;
  status: "active" | "cancelled" | "not_found";
  entityName: string | null;
  businessNames: string[];
  gstRegistered: boolean | null;
  state: string | null;
  postcode: string | null;
}

/**
 * The ABR's JSON service answers as JSONP: callback({...}). A "Message" means
 * it refused (a bad GUID, an ABN it doesn't know); an unknown ABN comes back
 * with no Abn at all.
 */
export function parseAbrResponse(text: string): AbnRecord | { error: string } {
  const body = /^\s*[\w$.]*\(([\s\S]*)\)\s*;?\s*$/.exec(text)?.[1] ?? text;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { error: "The ABR's answer couldn't be read" };
  }
  const message = typeof j.Message === "string" ? j.Message.trim() : "";
  const abn = typeof j.Abn === "string" ? j.Abn.replace(/\D/g, "") : "";
  if (!abn) {
    if (/not a valid abn|no records? found|not found/i.test(message) || !message) {
      return { abn: "", status: "not_found", entityName: null, businessNames: [], gstRegistered: null, state: null, postcode: null };
    }
    return { error: `The ABR refused: ${message}` };
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    abn,
    status: /^active$/i.test(String(j.AbnStatus ?? "")) ? "active" : "cancelled",
    entityName: str(j.EntityName),
    businessNames: Array.isArray(j.BusinessName) ? j.BusinessName.map(String).filter(Boolean) : [],
    // A GST start date means registered; empty or null means not.
    gstRegistered: j.Gst === undefined ? null : !!str(j.Gst),
    state: str(j.AddressState),
    postcode: str(j.AddressPostcode),
  };
}

/**
 * Whether the ABN's names include this business. Exact on the normalised name
 * (normalise.ts), against the entity name and every registered business name.
 * Anything less is not "certain", so it fails.
 */
export function abnNameMatches(record: AbnRecord, name: string | null | undefined): boolean {
  const want = normaliseName(name);
  if (!want) return false;
  return [record.entityName, ...record.businessNames].some((n) => normaliseName(n) === want);
}

export type AbnCheck =
  | { checked: true; record: AbnRecord; nameMatches: boolean }
  | { checked: false; reason: string };

/** Look an ABN up. Never throws; without ABR_GUID it says so and checks nothing. */
export async function lookupAbn(
  abnInput: string,
  name: string | null | undefined,
  guid = process.env.ABR_GUID,
): Promise<AbnCheck> {
  const abn = normaliseAbn(abnInput);
  if (!abn) return { checked: false, reason: "Not a valid ABN (it fails the ATO's check digit)" };
  if (!guid) return { checked: false, reason: "ABR_GUID isn't set, so the ABN was not checked by Pulse" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const q = new URLSearchParams({ abn, callback: "callback", guid });
    const res = await fetch(`https://abr.business.gov.au/json/AbnDetails.aspx?${q}`, { signal: ctrl.signal });
    const parsed = parseAbrResponse(await res.text());
    if ("error" in parsed) return { checked: false, reason: parsed.error };
    return { checked: true, record: parsed, nameMatches: abnNameMatches(parsed, name) };
  } catch (e) {
    return { checked: false, reason: `The ABR didn't answer: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}
