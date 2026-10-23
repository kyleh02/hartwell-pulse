import { NextResponse, type NextRequest } from "next/server";
import { linkForRequest, driveFailure } from "@/lib/drive-access";
import { getFile, resolvePath } from "@/lib/google-drive";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { decodePath, encodePath, isDriveId } from "@/lib/drive-shared";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * A batch of uploads has finished. When a client sent them, Kyle hears about
 * it the same way as an upload to Assets: a bell notification, and the email
 * nudge if it sits unread for half an hour.
 *
 * The files are checked to really be in the folder before anyone is told, so
 * this cannot be used to put an invented notification in front of Kyle.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    link?: string;
    p?: string;
    files?: { id?: string }[];
  } | null;
  const found = await linkForRequest(body?.link ?? null);
  if (found instanceof NextResponse) return found;
  const { link, session } = found;

  const path = decodePath(body?.p);
  const ids = (body?.files ?? []).map((f) => f.id ?? "").filter(isDriveId).slice(0, 50);
  if (!path || ids.length === 0) return NextResponse.json({ ok: true });
  if (session.role !== "client") return NextResponse.json({ ok: true });

  try {
    const resolved = await resolvePath(link.folder_id, path);
    const files = await Promise.all(ids.map((id) => getFile(id, "id,name,parents,trashed")));
    const real = files.filter((f) => !f.trashed && (f.parents ?? []).includes(resolved.folderId));
    if (real.length === 0) return NextResponse.json({ ok: true });

    const supabase = createAdminSupabase();
    const [{ data: admins }, { data: client }] = await Promise.all([
      supabase.from("client_users").select("clerk_user_id").eq("role", "admin"),
      supabase.from("clients").select("business_name").eq("id", link.client_id).maybeSingle(),
    ]);
    const who = session.profile?.full_name || session.profile?.email || "Someone";
    const names = real.map((f) => f.name);
    const what =
      names.length === 1
        ? names[0]
        : `${names.length} files: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`;
    const where = [link.title, ...resolved.crumbs.map((c) => c.name)].join(" / ");
    const href = `/admin/assets/drive/${link.id}${path.length ? `?p=${encodePath(path)}` : ""}`;

    const rows = ((admins as { clerk_user_id: string }[] | null) ?? []).map((a) => ({
      recipient_user_id: a.clerk_user_id,
      client_id: link.client_id,
      type: "asset_uploaded",
      title: `New upload from ${(client as { business_name: string } | null)?.business_name ?? "a client"}`,
      body: `${who}: ${what} (in ${where})`,
      link: href,
      channel: "in_portal",
    }));
    if (rows.length) {
      const { error } = await supabase.from("notifications").insert(rows);
      if (error) console.error("[drive] upload notification failed", error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return driveFailure(e, session.role);
  }
}
