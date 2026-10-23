import { NextResponse, type NextRequest } from "next/server";
import { linkForRequest, driveFailure } from "@/lib/drive-access";
import { appOrigin, resolvePath, startUpload } from "@/lib/google-drive";
import { decodePath } from "@/lib/drive-shared";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Two gigabytes. Drive takes more, but a browser upload that size is a mistake. */
const MAX_BYTES = 2 * 1024 ** 3;

/**
 * Open an upload into a shared folder. The browser then sends the file
 * straight to Google with the URL this returns, so nothing passes through
 * Vercel and there is no 4.5 MB ceiling.
 *
 * The destination is decided here from the checked path, never taken from the
 * browser, and the folder must take uploads twice over: Kyle allowed it on the
 * link, and his own Drive permission on that folder allows it.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    link?: string;
    p?: string;
    name?: string;
    type?: string;
    size?: number;
  } | null;
  const found = await linkForRequest(body?.link ?? null);
  if (found instanceof NextResponse) return found;
  const { link, session } = found;

  const path = decodePath(body?.p);
  const name = (body?.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  const size = Number(body?.size);
  if (!path || !name || !Number.isFinite(size) || size < 0) {
    return NextResponse.json({ error: "forbidden", message: "That upload is not valid." }, { status: 400 });
  }
  if (size > MAX_BYTES) {
    return NextResponse.json(
      { error: "too_large", message: `${name} is over 2 GB. Send it to Kyle another way.` },
      { status: 413 },
    );
  }
  if (session.role === "client" && !link.allow_uploads) {
    return NextResponse.json({ error: "forbidden", message: "This folder is view only." }, { status: 403 });
  }

  try {
    const resolved = await resolvePath(link.folder_id, path);
    if (!resolved.canAddChildren) {
      return NextResponse.json({ error: "forbidden", message: "This folder is view only." }, { status: 403 });
    }
    const who = session.profile?.full_name || session.profile?.email || "a client";
    const url = await startUpload({
      folderId: resolved.folderId,
      name,
      mimeType: (body?.type ?? "").slice(0, 200),
      size,
      // The page the upload runs from, so Google lets that page send it.
      origin: req.headers.get("origin") || appOrigin(),
      description:
        session.role === "admin"
          ? "Uploaded through the Hartwell portal."
          : `Uploaded by ${who} through the Hartwell portal.`,
    });
    return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return driveFailure(e, session.role);
  }
}
