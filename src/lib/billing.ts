// A client's billing identity, as printed in the Bill to block of an invoice.
// Client-safe and free of path aliases, so the profile form, the invoice and the
// tests all run the one implementation.

/** What an invoice says it is billed to. */
export interface BillTo {
  /** The business name the client is known by. Always present. */
  name: string;
  /** The registered entity, when it differs from `name`. */
  legal_name?: string | null;
  /** Eleven digits, unformatted. */
  abn?: string | null;
  address?: string | null;
  attention?: string | null;
}

/** The client fields billing is built from. */
export interface ClientBilling {
  business_name: string;
  legal_name?: string | null;
  abn?: string | null;
  billing_address?: string | null;
  billing_attention?: string | null;
}

// The ATO's published weights for the ABN check digit algorithm.
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Digits only, however it was typed: "44 286 503 049", "44-286-503-049". */
export function normaliseAbn(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

/**
 * Is this a real ABN?
 *
 * The ATO's check: subtract one from the first digit, weight each digit, and
 * the sum divides by 89. Catches a mistyped or transposed digit, which is the
 * mistake that matters: a wrong ABN on a tax invoice is worse than none, because
 * it names a different business.
 */
export function isValidAbn(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const d = digits.split("").map(Number);
  d[0] -= 1;
  const sum = d.reduce((s, n, i) => s + n * ABN_WEIGHTS[i], 0);
  return sum % 89 === 0;
}

/** "44 286 503 049", the way the ATO and every invoice writes it. */
export function formatAbn(digits: string): string {
  const d = normaliseAbn(digits);
  if (d.length !== 11) return digits;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
}

/**
 * Check an ABN as typed into the profile. Blank is allowed: an overseas client
 * or an individual may not have one.
 */
export function checkAbn(input: string): { abn: string | null; problem: string | null } {
  const digits = normaliseAbn(input);
  if (digits.length === 0) return { abn: null, problem: null };
  if (digits.length !== 11) {
    return {
      abn: null,
      problem: `An ABN is 11 digits, and that has ${digits.length}.`,
    };
  }
  if (!isValidAbn(digits)) {
    return {
      abn: null,
      problem: "That is not a valid ABN. Check it against the ABN Lookup, a digit is likely wrong.",
    };
  }
  return { abn: digits, problem: null };
}

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
};

/** The client's billing identity as it stands on their profile right now. */
export function billToFromClient(c: ClientBilling): BillTo {
  return {
    name: c.business_name,
    legal_name: clean(c.legal_name),
    abn: clean(c.abn),
    address: clean(c.billing_address),
    attention: clean(c.billing_attention),
  };
}

/**
 * What an invoice is billed to: what it was issued with if it has been sent,
 * otherwise the client's profile as it is now.
 *
 * Defensive about the stored shape, because it is JSON written over time. A
 * snapshot missing its name falls back to the client's, rather than printing a
 * blank Bill to.
 */
export function resolveBillTo(
  invoice: { bill_to?: unknown },
  client: ClientBilling,
): BillTo {
  const snap = invoice.bill_to;
  if (snap && typeof snap === "object") {
    const s = snap as Record<string, unknown>;
    const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : null);
    return {
      name: clean(str("name")) ?? client.business_name,
      legal_name: clean(str("legal_name")),
      abn: clean(str("abn")),
      address: clean(str("address")),
      attention: clean(str("attention")),
    };
  }
  return billToFromClient(client);
}
