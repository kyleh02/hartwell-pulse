// Client-safe board config + helpers.

export const BOARD_COLUMNS = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "delivered", label: "Delivered" },
] as const;

export const BOARD_COLUMN_KEYS = ["pending", "in_progress", "delivered"] as const;
export type BoardColumnKey = (typeof BOARD_COLUMN_KEYS)[number];

export const CARD_TYPES = [
  { key: "report", label: "Report" },
  { key: "ad_copy", label: "Ad copy" },
  { key: "social", label: "Social post" },
  { key: "website", label: "Website" },
  { key: "other", label: "Other" },
] as const;

export const CARD_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CARD_TYPES.map((t) => [t.key, t.label]),
);

export function isColumnKey(value: string): value is BoardColumnKey {
  return (BOARD_COLUMN_KEYS as readonly string[]).includes(value);
}
