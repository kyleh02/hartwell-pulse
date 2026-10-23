/**
 * Google Drive folders in the portal: the parts both the server and the
 * browser need. No secrets and no network here, so it is safe in a client
 * bundle and simple to test.
 */

export type DriveKind =
  | "folder"
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "doc"
  | "sheet"
  | "slides"
  | "drawing"
  | "google"
  | "file";

/** One thing inside a shared folder, as the browser receives it. */
export interface DriveEntry {
  /**
   * The id as it sits in this folder. For a shortcut that is the SHORTCUT's
   * id, which is what proves it belongs here; the content behind it is fetched
   * through the signed URLs below.
   */
  id: string;
  name: string;
  kind: DriveKind;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  /** Signed, short-lived portal URLs. Null where there is nothing to show. */
  thumb: string | null;
  view: string | null;
  download: string | null;
  /** Google Docs and friends have no file of their own; these are exports. */
  downloadAs: { label: string; url: string }[];
}

export interface DriveCrumb {
  id: string;
  name: string;
}

export interface DriveListing {
  link: { id: string; title: string };
  /** From the linked folder down, not including it. */
  crumbs: DriveCrumb[];
  canUpload: boolean;
  entries: DriveEntry[];
  /** Admin only: where this folder is in Google Drive. */
  driveUrl: string | null;
}

/** Google's ids are letters, digits, dash and underscore. */
const ID = /^[A-Za-z0-9_-]{10,200}$/;

export function isDriveId(s: string): boolean {
  return ID.test(s);
}

/**
 * The folder id from whatever Kyle pastes: a folder link from the address bar
 * or the Share dialog, an older open?id= link, or the bare id.
 */
export function parseDriveFolderId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (isDriveId(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/i.test(url.hostname)) return null;
  const folders = url.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,200})/);
  if (folders) return folders[1];
  const fileD = url.pathname.match(/\/d\/([A-Za-z0-9_-]{10,200})/);
  if (fileD) return fileD[1];
  const q = url.searchParams.get("id");
  if (q && isDriveId(q)) return q;
  return null;
}

/** A path down from the linked folder, as it travels in a URL: "a.b.c". */
export function encodePath(path: string[]): string {
  return path.join(".");
}

export function decodePath(s: string | null | undefined): string[] | null {
  if (!s) return [];
  const parts = s.split(".");
  if (parts.length > 25 || !parts.every(isDriveId)) return null;
  return parts;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

const GOOGLE_KIND: Record<string, DriveKind> = {
  "application/vnd.google-apps.document": "doc",
  "application/vnd.google-apps.spreadsheet": "sheet",
  "application/vnd.google-apps.presentation": "slides",
  "application/vnd.google-apps.drawing": "drawing",
};

export function kindOf(mime: string): DriveKind {
  if (mime === FOLDER_MIME) return "folder";
  if (GOOGLE_KIND[mime]) return GOOGLE_KIND[mime];
  if (mime.startsWith("application/vnd.google-apps.")) return "google";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

/**
 * What a Google-native file can be downloaded as. Docs, Sheets and Slides have
 * no file of their own, so a client gets an export, and PDF comes first because
 * it is what opens everywhere.
 */
export const EXPORTS: Partial<Record<DriveKind, { as: string; label: string; mime: string; ext: string }[]>> = {
  doc: [
    { as: "pdf", label: "PDF", mime: "application/pdf", ext: "pdf" },
    { as: "docx", label: "Word", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  ],
  sheet: [
    { as: "pdf", label: "PDF", mime: "application/pdf", ext: "pdf" },
    { as: "xlsx", label: "Excel", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  ],
  slides: [
    { as: "pdf", label: "PDF", mime: "application/pdf", ext: "pdf" },
    { as: "pptx", label: "PowerPoint", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" },
  ],
  drawing: [
    { as: "pdf", label: "PDF", mime: "application/pdf", ext: "pdf" },
    { as: "png", label: "PNG", mime: "image/png", ext: "png" },
  ],
};

/** Images a browser can show as they are. Anything else is previewed by thumbnail. */
const DISPLAYABLE_IMAGES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
]);

export function browserCanShow(mime: string): boolean {
  return DISPLAYABLE_IMAGES.has(mime);
}

/** "Northside logo.png" with the export's extension when it is one. */
export function exportFilename(name: string, ext: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return `${base}.${ext}`;
}

/** The portal page a client opens to see a linked folder. */
export function drivePagePath(linkId: string, path: string[] = []): string {
  const p = encodePath(path);
  return `/assets/drive/${linkId}${p ? `?p=${p}` : ""}`;
}
