/**
 * Draper's feature flag (docs/DRAPER.md, decision 2).
 *
 * Draper is built in stages on the `draper` branch, and each stage ships to
 * main dark. With OUTREACH_ENABLED unset, every Draper page and endpoint is a
 * 404 and the admin menu has no Draper entry. Row-level security and the admin
 * guards apply whether it is on or off: the flag hides Draper, it is not what
 * keeps clients out.
 *
 * Only "true" turns it on (any case, spaces ignored). Anything else, "1" and
 * "yes" included, leaves it off, so a typo fails closed.
 *
 * No server-only import here, so the test runner can load it.
 */
export function outreachEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env.OUTREACH_ENABLED ?? "").trim().toLowerCase() === "true";
}
