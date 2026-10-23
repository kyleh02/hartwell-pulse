import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { HARTWELL } from "@/lib/brand";
import { FOLDER_MIME, SHORTCUT_MIME, type DriveCrumb } from "@/lib/drive-shared";

/**
 * Kyle's Google Drive, read and written on his behalf.
 *
 * He connects once from Settings (OAuth, as admin@hartwelldigital.com), and the
 * refresh token that comes back is stored ENCRYPTED in a table only the service
 * role can read. That token opens his whole Drive, so three rules hold
 * everywhere in this file and the routes that use it:
 *
 * 1. Nothing a browser sends is trusted as a Drive id on its own. A request
 *    names a linked folder (a drive_links row the signed-in person can read)
 *    and a path down from it, and every step of the path is checked against
 *    Drive's own parent records before anything is listed or uploaded.
 * 2. File content goes out only through /api/drive/raw with a token this
 *    server signed while listing a folder it had just checked. The browser
 *    never sees a Google URL or a Google credential.
 * 3. Uploads go straight from the browser to Google through a one-file
 *    session this server opens, with the destination folder fixed here.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

/**
 * Full Drive access. The narrower drive.file scope only reaches files this app
 * created, and the point is to show folders Kyle already has. As an Internal
 * app on his Workspace, it needs no Google review.
 */
export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive", "openid", "email"];

export type DriveErrorCode =
  | "not_configured"
  | "not_connected"
  | "reconnect"
  | "not_found"
  | "forbidden"
  | "too_large"
  | "google";

export class DriveError extends Error {
  constructor(
    public code: DriveErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || `https://${HARTWELL.site}`).replace(/\/$/, "");
}

export function googleConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${appOrigin()}/api/google/callback` };
}

function requireConfig() {
  const cfg = googleConfig();
  if (!cfg) {
    throw new DriveError(
      "not_configured",
      "Google Drive is not set up yet: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing in Vercel.",
    );
  }
  return cfg;
}

export function authorizeUrl(state: string): string {
  const cfg = requireConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPES.join(" "),
    // offline + consent is what makes Google hand back a refresh token every
    // time, including on a reconnect.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: HARTWELL.email,
    state,
  });
  return `${AUTH_URL}?${params}`;
}

// ---------------------------------------------------------------------------
// the stored token
// ---------------------------------------------------------------------------

/**
 * AES-256-GCM keyed from the OAuth client secret. A database dump on its own
 * does not open Kyle's Drive, and rotating the secret in Google simply asks
 * for a reconnect, which is the right outcome after a rotation anyway.
 */
function tokenKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "pulse-drive", "refresh-token", 32));
}

export function sealToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

export function openToken(sealed: string, secret: string): string | null {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", tokenKey(secret), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function isMissingTable(err: { code?: string } | null | undefined): boolean {
  return !!err && (err.code === "PGRST205" || err.code === "42P01");
}

export interface DriveStatus {
  configured: boolean;
  /** Migration 0053 has not been run yet. */
  tablesMissing: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
}

export async function getDriveStatus(): Promise<DriveStatus> {
  const configured = !!googleConfig();
  const { data, error } = await createAdminSupabase()
    .from("google_drive_connection")
    .select("email, connected_at")
    .eq("id", 1)
    .maybeSingle();
  if (isMissingTable(error)) {
    return { configured, tablesMissing: true, connected: false, email: null, connectedAt: null };
  }
  if (error) throw new Error(`Drive connection lookup failed: ${error.message}`);
  const row = data as { email: string | null; connected_at: string } | null;
  return {
    configured,
    tablesMissing: false,
    connected: !!row,
    email: row?.email ?? null,
    connectedAt: row?.connected_at ?? null,
  };
}

export async function saveConnection(input: {
  refreshToken: string;
  email: string | null;
  scopes: string | null;
  connectedBy: string;
}): Promise<void> {
  const cfg = requireConfig();
  const { error } = await createAdminSupabase()
    .from("google_drive_connection")
    .upsert({
      id: 1,
      email: input.email,
      refresh_token_enc: sealToken(input.refreshToken, cfg.clientSecret),
      scopes: input.scopes,
      connected_by: input.connectedBy,
      connected_at: new Date().toISOString(),
    });
  if (error) throw new Error(`Could not save the Drive connection: ${error.message}`);
  cached = null;
}

/** Forget the connection, and tell Google so the token stops working too. */
export async function removeConnection(): Promise<void> {
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from("google_drive_connection")
    .select("refresh_token_enc")
    .eq("id", 1)
    .maybeSingle();
  const cfg = googleConfig();
  const sealed = (data as { refresh_token_enc: string } | null)?.refresh_token_enc;
  if (cfg && sealed) {
    const token = openToken(sealed, cfg.clientSecret);
    if (token) {
      // Best effort: the row goes either way, and a token Google no longer
      // honours is exactly the end state wanted.
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }).catch(() => {});
    }
  }
  const { error } = await supabase.from("google_drive_connection").delete().eq("id", 1);
  if (error) throw new Error(error.message);
  cached = null;
}

/** Swap the code Google sent back for tokens. */
export async function exchangeCode(code: string): Promise<{
  refreshToken: string | null;
  scope: string | null;
  email: string | null;
}> {
  const cfg = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    throw new DriveError("google", json.error_description || json.error || `Google said ${res.status}`);
  }
  // The id token came straight from Google over TLS in reply to our own
  // request, and only the address is read from it, for display.
  let email: string | null = null;
  if (json.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(json.id_token.split(".")[1], "base64url").toString("utf8"));
      email = typeof payload.email === "string" ? payload.email : null;
    } catch {
      email = null;
    }
  }
  if (json.access_token && json.expires_in) {
    cached = { token: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
  }
  return { refreshToken: json.refresh_token ?? null, scope: json.scope ?? null, email };
}

// ---------------------------------------------------------------------------
// access tokens
// ---------------------------------------------------------------------------

/** One per warm function instance; an access token lasts an hour. */
let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token;
  const cfg = requireConfig();
  const { data, error } = await createAdminSupabase()
    .from("google_drive_connection")
    .select("refresh_token_enc")
    .eq("id", 1)
    .maybeSingle();
  if (isMissingTable(error)) {
    throw new DriveError("not_connected", "Run migration 0053 in Supabase, then connect Google Drive in Settings.");
  }
  if (error) throw new Error(`Drive connection lookup failed: ${error.message}`);
  const sealed = (data as { refresh_token_enc: string } | null)?.refresh_token_enc;
  if (!sealed) throw new DriveError("not_connected", "Google Drive is not connected. Connect it in Settings.");
  const refresh = openToken(sealed, cfg.clientSecret);
  if (!refresh) {
    throw new DriveError("reconnect", "The saved Google connection can no longer be read. Reconnect Google Drive in Settings.");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") {
      throw new DriveError("reconnect", "Google has withdrawn the portal's access to Drive. Reconnect it in Settings.");
    }
    throw new DriveError("google", `Google sign-in failed: ${json.error ?? res.status}`);
  }
  cached = {
    token: json.access_token,
    expires: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
  };
  return cached.token;
}

/** A Drive API call with the access token, retried once if it has just lapsed. */
export async function driveFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  if (res.status === 401 && retry) {
    cached = null;
    return driveFetch(url, init, false);
  }
  return res;
}

async function driveError(res: Response, what: string): Promise<DriveError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; errors?: { reason?: string }[] };
  } | null;
  const reason = body?.error?.errors?.[0]?.reason;
  if (res.status === 404) return new DriveError("not_found", `${what} could not be found in Drive.`);
  if (reason === "exportSizeLimitExceeded") {
    return new DriveError("too_large", "This document is too large for Google to convert.");
  }
  if (res.status === 403) return new DriveError("forbidden", body?.error?.message ?? `${what} is not available.`);
  return new DriveError("google", body?.error?.message ?? `Google Drive said ${res.status}.`);
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

export interface GFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  hasThumbnail?: boolean;
  thumbnailLink?: string;
  parents?: string[];
  trashed?: boolean;
  shortcutDetails?: { targetId: string; targetMimeType: string };
  capabilities?: { canAddChildren?: boolean };
}

const META_FIELDS =
  "id,name,mimeType,size,modifiedTime,hasThumbnail,parents,trashed,shortcutDetails(targetId,targetMimeType),capabilities(canAddChildren)";

const ALL_DRIVES = "supportsAllDrives=true";

export async function getFile(id: string, fields = META_FIELDS): Promise<GFile> {
  const res = await driveFetch(
    `${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}&${ALL_DRIVES}`,
  );
  if (!res.ok) throw await driveError(res, "That item");
  return (await res.json()) as GFile;
}

/** Everything directly inside a folder, folders first, in the order Drive shows. */
export async function listFolder(folderId: string): Promise<GFile[]> {
  const out: GFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: `nextPageToken,files(${META_FIELDS})`,
      orderBy: "folder,name_natural",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await driveFetch(`${API}/files?${params}`);
    if (!res.ok) throw await driveError(res, "That folder");
    const json = (await res.json()) as { files?: GFile[]; nextPageToken?: string };
    out.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
    // A folder of thousands is not what this is for; stop well short of a
    // function timeout rather than paging forever.
  } while (pageToken && out.length < 5000);
  return out;
}

/**
 * The folder a link points at, with shortcuts followed. Used when linking, so
 * the stored id is always a real folder.
 */
export async function resolveFolder(id: string): Promise<GFile> {
  const f = await getFile(id);
  if (f.trashed) throw new DriveError("not_found", "That folder is in the bin in Drive.");
  if (f.mimeType === SHORTCUT_MIME && f.shortcutDetails?.targetMimeType === FOLDER_MIME) {
    return resolveFolder(f.shortcutDetails.targetId);
  }
  if (f.mimeType !== FOLDER_MIME) {
    throw new DriveError("forbidden", "That link is to a file, not a folder. Paste the link to the folder.");
  }
  return f;
}

export interface ResolvedPath {
  /** The real folder at the end of the path, shortcuts followed. */
  folderId: string;
  canAddChildren: boolean;
  crumbs: DriveCrumb[];
}

/**
 * Check a path down from a linked folder, one parent at a time.
 *
 * The path holds each item's id AS IT SITS in its parent: a subfolder's own id,
 * or a shortcut's id. Each must list the previous folder among its Drive
 * parents. A shortcut is then followed to its target, which is how a folder
 * from another drive can appear inside a client's folder: Kyle put the
 * shortcut there, and that decision is what grants it.
 *
 * The lookups run in parallel and the chain is checked afterwards, so a deep
 * folder costs one round trip, not one per level.
 */
export async function resolvePath(rootFolderId: string, path: string[]): Promise<ResolvedPath> {
  if (path.length > 25) throw new DriveError("forbidden", "That folder is nested too deeply.");
  const [root, ...steps] = await Promise.all([
    getFile(rootFolderId),
    ...path.map((id) => getFile(id)),
  ]);
  if (root.trashed) throw new DriveError("not_found", "The shared folder is in the bin in Drive.");

  let current = root.id;
  let canAdd = !!root.capabilities?.canAddChildren;
  let lastTarget: string | null = null;
  const crumbs: DriveCrumb[] = [];
  for (const step of steps) {
    if (step.trashed || !(step.parents ?? []).includes(current)) {
      throw new DriveError("forbidden", "That folder is not part of this shared folder.");
    }
    if (step.mimeType === FOLDER_MIME) {
      current = step.id;
      canAdd = !!step.capabilities?.canAddChildren;
      lastTarget = null;
    } else if (step.mimeType === SHORTCUT_MIME && step.shortcutDetails?.targetMimeType === FOLDER_MIME) {
      current = step.shortcutDetails.targetId;
      lastTarget = current;
    } else {
      throw new DriveError("forbidden", "That is not a folder.");
    }
    crumbs.push({ id: step.id, name: step.name });
  }
  // Whether a shortcut's target takes uploads is a fact about the target, so
  // it costs one more lookup, and only when the path ends on a shortcut.
  if (lastTarget) {
    const target = await getFile(lastTarget);
    if (target.trashed) throw new DriveError("not_found", "That folder is in the bin in Drive.");
    canAdd = !!target.capabilities?.canAddChildren;
  }
  return { folderId: current, canAddChildren: canAdd, crumbs };
}

// ---------------------------------------------------------------------------
// uploads
// ---------------------------------------------------------------------------

/**
 * Open a resumable upload session for one file into one folder.
 *
 * The session URL lets whoever holds it upload the bytes of THIS file into
 * THIS folder and nothing else, so it is safe to hand to the browser, which
 * then sends the file straight to Google. Passing the browser's origin here is
 * what lets Google accept that cross-site upload. Going through Vercel instead
 * would cap every upload at 4.5 MB.
 */
export async function startUpload(input: {
  folderId: string;
  name: string;
  mimeType: string;
  size: number;
  origin: string;
  description: string;
}): Promise<string> {
  const res = await driveFetch(
    `${UPLOAD_API}/files?uploadType=resumable&${ALL_DRIVES}&fields=id,name,mimeType,size,parents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType || "application/octet-stream",
        "X-Upload-Content-Length": String(input.size),
        Origin: input.origin,
      },
      body: JSON.stringify({
        name: input.name,
        parents: [input.folderId],
        description: input.description,
      }),
    },
  );
  if (!res.ok) throw await driveError(res, "The folder");
  const url = res.headers.get("location");
  if (!url) throw new DriveError("google", "Google did not open an upload.");
  return url;
}

// ---------------------------------------------------------------------------
// signed file URLs
// ---------------------------------------------------------------------------

/**
 * A token for /api/drive/raw, minted only while listing a folder that has just
 * been checked, so the route serving the bytes needs no session of its own.
 * That matters because images, PDFs and video are fetched by the browser
 * itself, sometimes long after the page loaded.
 *
 * The expiry is rounded to a half hour so the same file gets the same URL for
 * a while, which lets the browser cache thumbnails between visits. It lives
 * 60 to 90 minutes; the folder view refreshes its listing well inside that.
 */
export interface RawClaim {
  /** drive_links.id, rechecked on every request so unlinking takes effect at once. */
  l: string;
  /** The Drive id of the content, shortcuts already followed. */
  f: string;
  /** Its mime type, which decides export versus download. */
  m: string;
  /** File name, for the download. */
  n: string;
  /** Expiry, ms. */
  e: number;
}

const BUCKET = 30 * 60 * 1000;

function rawSecret(): string | null {
  return process.env.CRON_SECRET || null;
}

function signRaw(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`drive.${body}`).digest("base64url");
}

export function mintRawToken(claim: Omit<RawClaim, "e">, now = Date.now()): string | null {
  const secret = rawSecret();
  if (!secret) return null;
  const e = (Math.floor(now / BUCKET) + 3) * BUCKET;
  const body = Buffer.from(JSON.stringify({ ...claim, e })).toString("base64url");
  return `${body}.${signRaw(body, secret)}`;
}

export function readRawToken(token: string, now = Date.now()): RawClaim | null {
  const secret = rawSecret();
  if (!secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = signRaw(body, secret);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let claim: RawClaim;
  try {
    claim = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as RawClaim;
  } catch {
    return null;
  }
  if (typeof claim.e !== "number" || now > claim.e) return null;
  return claim;
}

/** The bytes of a file, passing a Range through so video can seek. */
export async function fetchMedia(fileId: string, range: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (range) headers.Range = range;
  const res = await driveFetch(
    `${API}/files/${encodeURIComponent(fileId)}?alt=media&${ALL_DRIVES}`,
    { headers },
  );
  if (!res.ok && res.status !== 206) throw await driveError(res, "That file");
  return res;
}

/** A Google Doc, Sheet or Slides deck converted on the way out. */
export async function fetchExport(fileId: string, mime: string): Promise<Response> {
  const res = await driveFetch(
    `${API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mime)}`,
  );
  if (!res.ok) throw await driveError(res, "That document");
  return res;
}

/** Drive's own thumbnail, at the size asked for. */
export async function fetchThumbnail(fileId: string, size: number): Promise<Response | null> {
  const f = await getFile(fileId, "id,hasThumbnail,thumbnailLink");
  if (!f.thumbnailLink) return null;
  const url = f.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
  // The link usually carries its own key; the bearer covers the cases where
  // it does not. Either way only this server ever sees it.
  const res = await driveFetch(url);
  if (res.ok) return res;
  const bare = await fetch(url, { cache: "no-store" });
  return bare.ok ? bare : null;
}
