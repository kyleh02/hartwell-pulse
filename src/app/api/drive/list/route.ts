import { NextResponse, type NextRequest } from "next/server";
import { linkForRequest, driveFailure } from "@/lib/drive-access";
import { listFolder, mintRawToken, resolvePath, type GFile } from "@/lib/google-drive";
import {
  EXPORTS,
  SHORTCUT_MIME,
  browserCanShow,
  decodePath,
  kindOf,
  type DriveEntry,
  type DriveListing,
} from "@/lib/drive-shared";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * One folder of a client's shared Drive folder: what is in it, and signed
 * URLs for each file. The path is checked against Drive's parent records
 * before anything is listed (see resolvePath).
 */
export async function GET(req: NextRequest) {
  const found = await linkForRequest(req.nextUrl.searchParams.get("link"));
  if (found instanceof NextResponse) return found;
  const { link, session } = found;

  const path = decodePath(req.nextUrl.searchParams.get("p"));
  if (!path) {
    return NextResponse.json({ error: "forbidden", message: "That folder address is not valid." }, { status: 400 });
  }

  try {
    const resolved = await resolvePath(link.folder_id, path);
    const files = await listFolder(resolved.folderId);
    const listing: DriveListing = {
      link: { id: link.id, title: link.title },
      crumbs: resolved.crumbs,
      canUpload: resolved.canAddChildren && (session.role === "admin" || link.allow_uploads),
      entries: files.map((f) => toEntry(link.id, f)).filter((e): e is DriveEntry => e !== null),
      driveUrl:
        session.role === "admin" ? `https://drive.google.com/drive/folders/${resolved.folderId}` : null,
    };
    return NextResponse.json(listing, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return driveFailure(e, session.role);
  }
}

function toEntry(linkId: string, f: GFile): DriveEntry | null {
  const isShortcut = f.mimeType === SHORTCUT_MIME;
  if (isShortcut && !f.shortcutDetails) return null;
  const mime = isShortcut ? f.shortcutDetails!.targetMimeType : f.mimeType;
  const contentId = isShortcut ? f.shortcutDetails!.targetId : f.id;
  const kind = kindOf(mime);

  const base: DriveEntry = {
    id: f.id,
    name: f.name,
    kind,
    mimeType: mime,
    size: f.size ? Number(f.size) : null,
    modifiedTime: f.modifiedTime ?? null,
    thumb: null,
    view: null,
    download: null,
    downloadAs: [],
  };
  if (kind === "folder") return base;

  const token = mintRawToken({ l: linkId, f: contentId, m: mime, n: f.name });
  if (!token) return base;
  const url = `/api/drive/raw/${token}/${encodeURIComponent(f.name)}`;

  // A shortcut does not carry its target's thumbnail flag; the kinds that
  // normally have one are tried, and the browser falls back to an icon.
  const thumbable = isShortcut
    ? ["image", "pdf", "video", "doc", "sheet", "slides", "drawing"].includes(kind)
    : !!f.hasThumbnail;
  base.thumb = thumbable ? `${url}?m=thumb&s=400` : null;

  const exports = EXPORTS[kind];
  if (exports) {
    base.view = url;
    base.download = `${url}?m=dl&as=${exports[0].as}`;
    base.downloadAs = exports.map((x) => ({ label: x.label, url: `${url}?m=dl&as=${x.as}` }));
    return base;
  }
  if (kind === "google") return base; // Forms, Sites and the like: Drive only.

  if (kind === "image") {
    // HEIC from an iPhone, TIFF and so on: Drive's large thumbnail is a
    // perfectly good preview and the original is still one tap away.
    base.view = browserCanShow(mime) ? url : base.thumb ? `${url}?m=thumb&s=1600` : null;
  } else if (kind === "pdf" || kind === "video" || kind === "audio") {
    base.view = url;
  }
  base.download = `${url}?m=dl`;
  return base;
}
