/**
 * Australian public holidays by state, for Draper's sending days (decision 7).
 * Generated from an official dataset once Kyle OKs the download; until then
 * it is empty, and Draper refuses to schedule any date it doesn't cover, so a
 * missing year stops sending rather than sending on a holiday.
 *
 * Shape: { "2026": { "VIC": ["2026-01-01", ...], "QLD": [...], ... }, ... }
 */
export const AU_HOLIDAYS: Record<string, Record<string, string[]>> = {};

/** Where the dates came from, shown on the Draper page. */
export const AU_HOLIDAYS_SOURCE = "Not loaded yet";
