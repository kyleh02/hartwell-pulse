/**
 * The content approval board: what both sides and the browser need. No
 * secrets, no network, so it is safe in a client bundle and easy to test.
 */

export type ApprovalKind = "copy" | "design" | "social" | "ad";
export type ApprovalStatus = "draft" | "waiting" | "changes" | "approved";

export interface Approval {
  id: string;
  client_id: string;
  kind: ApprovalKind;
  title: string;
  body: string | null;
  note: string | null;
  channel: string | null;
  status: ApprovalStatus;
  round: number;
  due_on: string | null;
  sent_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalFile {
  id: string;
  approval_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  position: number;
  /** Signed for the page that shows it; never stored. */
  url?: string | null;
}

export interface ApprovalEvent {
  id: string;
  kind: "sent" | "approved" | "changes" | "comment";
  body: string | null;
  round: number;
  author_role: "admin" | "client" | null;
  author_name: string | null;
  created_at: string;
}

export const KINDS: Record<ApprovalKind, { label: string; plural: string; bodyLabel: string; channelHint: string }> = {
  copy: { label: "Website copy", plural: "Website copy", bodyLabel: "The words", channelHint: "Which page, e.g. Home" },
  design: { label: "Design", plural: "Designs", bodyLabel: "Notes on the design (optional)", channelHint: "Where it is for, e.g. Logo, Flyer" },
  social: { label: "Social post", plural: "Social posts", bodyLabel: "The caption", channelHint: "Where it goes, e.g. Instagram" },
  ad: { label: "Ad", plural: "Ads", bodyLabel: "The ad text", channelHint: "Where it runs, e.g. Google Ads" },
};

/** How each side reads a status. The client is told what is theirs to do. */
export function statusLabel(status: ApprovalStatus, role: "client" | "admin"): string {
  if (status === "draft") return "Draft";
  if (status === "approved") return "Approved";
  if (status === "waiting") return role === "client" ? "Waiting on you" : "With the client";
  return role === "client" ? "Kyle is updating it" : "Changes asked for";
}

/** The board's three columns, in reading order, for each side. */
export const COLUMNS: { status: ApprovalStatus; client: string; admin: string; empty: { client: string; admin: string } }[] = [
  {
    status: "waiting",
    client: "Waiting on you",
    admin: "With the client",
    empty: { client: "Nothing waiting on you.", admin: "Nothing out with clients." },
  },
  {
    status: "changes",
    client: "With Kyle",
    admin: "Changes asked for",
    empty: { client: "Nothing being changed.", admin: "No changes asked for." },
  },
  {
    status: "approved",
    client: "Approved",
    admin: "Approved",
    empty: { client: "Nothing approved yet.", admin: "Nothing approved yet." },
  },
];

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

/** The storage bucket's own cap is 50 MB a file. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 12;

const ALLOWED = ["jpg", "jpeg", "png", "gif", "webp", "svg", "pdf", "mp4", "mov", "webm", "docx", "pptx"] as const;
export const ACCEPT = ALLOWED.map((e) => `.${e}`).join(",");

export function extensionOf(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
}

export function isImage(name: string, mime?: string | null): boolean {
  return (mime ?? "").startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extensionOf(name));
}

export function isVideo(name: string, mime?: string | null): boolean {
  return (mime ?? "").startsWith("video/") || ["mp4", "mov", "webm"].includes(extensionOf(name));
}

export function checkFile(file: { name: string; size: number }, existingCount: number): string | null {
  if (!(ALLOWED as readonly string[]).includes(extensionOf(file.name))) {
    return `"${file.name}" can't be added. Use an image, PDF, video, Word or PowerPoint file.`;
  }
  if (!(file.size > 0)) return `"${file.name}" is empty.`;
  if (file.size > MAX_FILE_BYTES) return `"${file.name}" is over 50 MB.`;
  if (existingCount >= MAX_FILES) return `Up to ${MAX_FILES} files per piece of work. Remove one first.`;
  return null;
}

export function approvalFolder(clientId: string, approvalId: string): string {
  return `${clientId}/approvals/${approvalId}`;
}

/** A storage key from a filename: safe characters only, extension kept. */
export function storageKeyName(name: string): string {
  const ext = extensionOf(name);
  const base = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "file";
  return ext ? `${base}.${ext}` : base;
}

export function approvalFilePath(clientId: string, approvalId: string, uniqueId: string, name: string): string {
  return `${approvalFolder(clientId, approvalId)}/${uniqueId}-${storageKeyName(name)}`;
}

/**
 * May this approval claim this stored file? The path comes from the browser,
 * so it is checked: one level inside this approval's own folder, nothing else.
 */
export function isApprovalPathFor(path: string, clientId: string, approvalId: string): boolean {
  const prefix = `${approvalFolder(clientId, approvalId)}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/") && !rest.includes("..");
}

/** A filename fit to show and to download as. */
export function displayFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 120) || "file";
}

/** "Fri 31 Oct", for a due date stored as a plain date. */
export function dueLabel(due: string | null): string | null {
  if (!due) return null;
  return new Date(`${due.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
