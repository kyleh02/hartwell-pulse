/**
 * Contact lists kept elsewhere, turned into fingerprint keys. The brief asks
 * for domain, email and business name; ABN and phone are taken too when a
 * column carries them. Headers are matched loosely ("Website", "Company",
 * "Email address" all work) and anything else in the file is ignored.
 *
 * Pure, so it can be tested.
 */
import { businessKeys, type Key } from "./normalise.ts";

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Accepted headers for each kind, best first. "name" comes last, because a
 * file with a business column and a person's name column means the business. */
const COLUMNS: Record<"domain" | "email" | "name" | "abn" | "phone", string[]> = {
  domain: ["domain", "website domain", "website", "web site", "web", "url", "site"],
  email: ["email", "e-mail", "email address", "published email", "contact email"],
  name: ["business", "business name", "company", "company name", "trading name", "organisation", "organization", "name"],
  abn: ["abn"],
  phone: ["phone", "phone number", "telephone", "mobile", "tel"],
};

export interface ImportResult {
  keys: Key[];
  rows: number;
  /** Rows that gave no key at all. */
  skipped: number;
  /** Which column each kind was read from, for the screen. */
  columns: Partial<Record<keyof typeof COLUMNS, string>>;
  problem?: string;
}

/** Keys from a CSV whose first row is a header. */
export function keysFromCsv(text: string): ImportResult {
  const table = parseCsv(text);
  if (table.length < 2) return { keys: [], rows: 0, skipped: 0, columns: {}, problem: "The file has no rows under its header." };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[_\s]+/g, " "));
  const index: Partial<Record<keyof typeof COLUMNS, number>> = {};
  const columns: ImportResult["columns"] = {};
  for (const kind of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
    const at = COLUMNS[kind].map((want) => header.indexOf(want)).find((i) => i >= 0) ?? -1;
    if (at >= 0) {
      index[kind] = at;
      columns[kind] = table[0][at].trim();
    }
  }
  if (index.domain === undefined && index.email === undefined && index.name === undefined) {
    return {
      keys: [],
      rows: table.length - 1,
      skipped: table.length - 1,
      columns,
      problem: "No domain, email or business name column. The first row needs headers like domain, email, business.",
    };
  }
  const all = new Map<string, Key>();
  let skipped = 0;
  for (const r of table.slice(1)) {
    const cell = (k: keyof typeof COLUMNS) => (index[k] === undefined ? null : (r[index[k]!] ?? null));
    const keys = businessKeys({
      domain: cell("domain"),
      email: cell("email"),
      name: cell("name"),
      abn: cell("abn"),
      phone: cell("phone"),
    });
    if (keys.length === 0) skipped++;
    for (const k of keys) all.set(`${k.kind}:${k.value}`, k);
  }
  return { keys: [...all.values()], rows: table.length - 1, skipped, columns };
}
