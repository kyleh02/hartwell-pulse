// Client-safe constants + helpers for assets. No server-only imports.
import type { Asset } from "@/lib/types/database";

export interface AssetWithUrl extends Asset {
  /** A short-lived signed URL for previews/downloads (null if unresolved). */
  url: string | null;
  /** Client business name, attached for the admin's all-clients view. */
  client_name?: string | null;
}

export const ASSET_FOLDERS = [
  "Website Assets",
  "Social Media",
  "Email",
  "Ad Copy",
  "Other",
] as const;

export const ASSET_TAGS = [
  "Draft",
  "Approved",
  "Ready to Use",
  "Urgent",
] as const;

export const TAG_TONE: Record<
  string,
  "neutral" | "gold" | "success" | "warn" | "danger"
> = {
  Draft: "neutral",
  Approved: "success",
  "Ready to Use": "gold",
  Urgent: "danger",
};

export type AssetKind = "image" | "document" | "copy" | "other";

export function kindFromMime(mime: string | null | undefined): AssetKind {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "copy";
  if (
    mime === "application/pdf" ||
    mime.includes("word") ||
    mime.includes("document") ||
    mime.includes("spreadsheet") ||
    mime.includes("presentation")
  ) {
    return "document";
  }
  return "other";
}

export function isImageMime(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("image/");
}

export function folderSlug(folder: string): string {
  return folder
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
