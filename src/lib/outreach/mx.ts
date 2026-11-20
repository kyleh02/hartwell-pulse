import { resolveMx } from "node:dns/promises";

/**
 * Who runs an address's mail, from its domain's MX records (the brief's
 * learning record: "the address's mail provider"). google, microsoft or
 * other; null when there are no MX records to read.
 */
export type MxProvider = "google" | "microsoft" | "other";

export function mxProvider(exchanges: string[]): MxProvider | null {
  const hosts = exchanges.map((h) => h.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (!hosts.length) return null;
  if (hosts.some((h) => /(^|\.)(google|googlemail)\.com$/.test(h))) return "google";
  if (hosts.some((h) => /(^|\.)(outlook|hotmail)\.com$|\.protection\.outlook\.com$|(^|\.)office365\.com$/.test(h))) return "microsoft";
  return "other";
}

/** Look it up; never throws. */
export async function lookupMxProvider(email: string): Promise<MxProvider | null> {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return null;
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    return mxProvider(records.map((r) => r.exchange));
  } catch {
    return null;
  }
}
