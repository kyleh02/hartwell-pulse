// The rules for documents sent alongside an invoice. Client-safe and free of
// path aliases, so the uploader, the server action and the tests all run the
// one implementation.

/** How many documents one invoice may carry. */
export const MAX_ATTACHMENTS = 5;

/**
 * How much they may weigh together.
 *
 * Two limits meet here. Resend refuses an email over 40 MB, measured AFTER
 * base64 encoding, which inflates every file by a third. And the Send button is
 * a server action, which on Hobby gets ten seconds to download every file and
 * hand the lot to Resend once per recipient. Ten megabytes is far more than any
 * quote or scope document needs and leaves room for both.
 */
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * An allowlist rather than a blocklist. Mail providers strip or refuse
 * executable types, and a file the client cannot open is worse than one that
 * was never attached, because the email says it is there.
 */
export const ALLOWED_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "ppt",
  "pptx",
  "txt",
  "png",
  "jpg",
  "jpeg",
] as const;

/** For the file input, so the picker offers only what will be accepted. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * The name the client sees on the attachment. Characters that are path
 * separators or that mail clients refuse in a filename are removed; everything
 * else is kept exactly as uploaded.
 */
export function displayFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
  return cleaned || "document";
}

/**
 * The storage key. Never the display name: plain ASCII with no spaces, so a
 * name like "Scope — Stage 3 (final).pdf" cannot produce a key that a URL or a
 * storage API mangles.
 */
export function storageKeyName(name: string): string {
  const ext = extensionOf(name);
  const base =
    displayFileName(name)
      .replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "document";
  return ext ? `${base}.${ext}` : base;
}

/**
 * Where an invoice's documents live. The client id has to be the FIRST
 * segment: the storage read policy keys off it, and it is what stops one client
 * reaching another's files.
 */
export function attachmentFolder(clientId: string, invoiceId: string): string {
  return `${clientId}/${invoiceId}/attachments`;
}

export function attachmentPath(
  clientId: string,
  invoiceId: string,
  uniqueId: string,
  name: string,
): string {
  return `${attachmentFolder(clientId, invoiceId)}/${uniqueId}-${storageKeyName(name)}`;
}

/**
 * May this invoice claim this stored file?
 *
 * The path arrives from the browser, so it is checked rather than trusted.
 * Without this, a crafted request could record another client's file against
 * this invoice and email it to the wrong person.
 */
export function isAttachmentPathFor(
  path: string,
  clientId: string,
  invoiceId: string,
): boolean {
  const prefix = `${attachmentFolder(clientId, invoiceId)}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/") && !rest.includes("..");
}

/**
 * Can this file be added to an invoice already carrying `existing`? A sentence
 * saying why not, or null.
 */
export function checkNewAttachment(
  file: { name: string; size: number },
  existing: { size_bytes: number }[],
): string | null {
  const ext = extensionOf(file.name);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `"${file.name}" cannot be attached. Use a PDF, Word, Excel, PowerPoint, CSV, text or image file.`;
  }
  if (!(file.size > 0)) return `"${file.name}" is empty.`;
  if (existing.length >= MAX_ATTACHMENTS) {
    return `An invoice can carry up to ${MAX_ATTACHMENTS} documents. Remove one first.`;
  }
  const used = existing.reduce((s, a) => s + Number(a.size_bytes), 0);
  if (used + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
    return `"${file.name}" is ${megabytes(file.size)}, which would take this invoice's documents over ${megabytes(MAX_TOTAL_ATTACHMENT_BYTES)} together. Compress it or share it from Assets instead.`;
  }
  return null;
}
