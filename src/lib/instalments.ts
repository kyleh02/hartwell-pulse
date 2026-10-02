// Splitting an invoice into instalments. Client-safe: no server imports, so the
// builder, the document and the cron all compute from the one implementation.
//
// EVERYTHING HERE IS INTEGER CENTS. The rest of the invoice maths works in
// floats rounded to two places, which is fine when a figure is only ever shown.
// It is not fine here: a split has to reconcile EXACTLY against its parent, and
// floats do not have exact halves of odd cents.

/** Dollars (as entered or stored) to whole cents. */
export function toCents(dollars: number | string): number {
  return Math.round(Number(dollars ?? 0) * 100);
}

/** Whole cents back to the dollars the rest of the app deals in. */
export function toDollars(cents: number): number {
  return cents / 100;
}

export interface Money {
  /** Ex GST. */
  exCents: number;
  gstCents: number;
  /** Ex GST plus GST. What the client pays for this instalment. */
  totalCents: number;
}

export interface InstalmentPlan {
  parts: Money[];
  /** Null when the plan reconciles. A sentence naming the problem when it does not. */
  problem: string | null;
}

/**
 * Work out the ex GST and GST of each instalment from the GST-inclusive amounts
 * entered against them.
 *
 * The amounts are entered inclusive because that is how the agreement gets made:
 * "half of the eighteen eighty one" is 940.50, not 855.00 plus GST.
 *
 * Each instalment takes its share of the parent's ex GST figure, and its GST is
 * then the difference between that and its own total, so ex plus GST always
 * equals the amount the client was promised, to the cent.
 *
 * The LAST instalment is not calculated. It is whatever is left of the parent
 * once the others are taken off: ex, GST and total each. That is what makes the
 * set reconcile by construction instead of by hope, and it is where any rounding
 * remainder lands. Dividing the parent's GST figure and rounding each share is
 * the way this is normally got wrong, because three rounded thirds do not add up.
 */
export function planInstalments(
  parent: Money,
  amountsCents: number[],
): InstalmentPlan {
  const n = amountsCents.length;
  if (n < 2) {
    return { parts: [], problem: "A split needs at least two instalments." };
  }
  if (amountsCents.some((c) => !Number.isInteger(c) || c <= 0)) {
    return { parts: [], problem: "Every instalment must be a positive amount." };
  }
  const sum = amountsCents.reduce((a, b) => a + b, 0);
  if (sum !== parent.totalCents) {
    const diff = (sum - parent.totalCents) / 100;
    return {
      parts: [],
      problem:
        diff > 0
          ? `The instalments add up to ${diff.toFixed(2)} more than the invoice.`
          : `The instalments are ${Math.abs(diff).toFixed(2)} short of the invoice.`,
    };
  }

  const parts: Money[] = [];
  let exUsed = 0;
  let gstUsed = 0;
  let totalUsed = 0;

  for (let i = 0; i < n - 1; i++) {
    const totalCents = amountsCents[i];
    // Share of the parent's ex GST, in the same proportion as this instalment is
    // of the whole. Taking the share of ex rather than applying a rate keeps it
    // correct when GST is nil or already included, and when a discount means the
    // ex figure is not simply the total over 1.1.
    const exCents =
      parent.totalCents === 0
        ? 0
        : Math.round((totalCents * parent.exCents) / parent.totalCents);
    const gstCents = totalCents - exCents;
    parts.push({ exCents, gstCents, totalCents });
    exUsed += exCents;
    gstUsed += gstCents;
    totalUsed += totalCents;
  }

  // The remainder, carrying whatever the rounding left behind.
  parts.push({
    exCents: parent.exCents - exUsed,
    gstCents: parent.gstCents - gstUsed,
    totalCents: parent.totalCents - totalUsed,
  });

  const last = parts[parts.length - 1];
  if (last.exCents + last.gstCents !== last.totalCents) {
    return {
      parts: [],
      problem:
        "The invoice's own ex GST, GST and total do not add up, so it cannot be split cleanly.",
    };
  }
  return { parts, problem: null };
}

/** An even split, to the cent, with the odd cent on the last instalment. */
export function evenAmounts(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  const out = Array(n).fill(base);
  out[n - 1] = totalCents - base * (n - 1);
  return out;
}

/** Percentages to cents. The last takes the remainder, so they always sum. */
export function percentAmounts(totalCents: number, percents: number[]): number[] {
  const out = percents
    .slice(0, -1)
    .map((p) => Math.round((totalCents * p) / 100));
  out.push(totalCents - out.reduce((a, b) => a + b, 0));
  return out;
}
