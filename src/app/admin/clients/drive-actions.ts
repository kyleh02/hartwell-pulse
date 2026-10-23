"use server";

import { revalidatePath } from "next/cache";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  DriveError,
  getDriveStatus,
  removeConnection,
  resolveFolder,
  type DriveStatus,
} from "@/lib/google-drive";
import { drivePagePath, parseDriveFolderId } from "@/lib/drive-shared";
import { emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { firstName, resolveRecipients } from "@/lib/recipients";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function requireAdmin() {
  const session = await getPulseSession();
  if (session?.role !== "admin") throw new Error("Not authorised");
  return session;
}

function isMissingTable(err: { code?: string } | null | undefined): boolean {
  return !!err && (err.code === "PGRST205" || err.code === "42P01");
}

const RUN_MIGRATION = "Run migration 0053 in the Supabase SQL Editor first.";

export async function driveStatus(): Promise<DriveStatus> {
  await requireAdmin();
  return getDriveStatus();
}

/**
 * Share a Drive folder with a client through the portal.
 *
 * The folder is looked up in Drive first, so a typo, a file link or a folder
 * Kyle's account cannot open is caught here and not by the client. Shortcuts
 * are followed, so the stored id is always the real folder.
 */
export async function linkDriveFolder(
  clientId: string,
  input: string,
  title: string,
): Promise<Result> {
  const session = await requireAdmin();
  const id = parseDriveFolderId(input);
  if (!id) {
    return { ok: false, message: "That doesn't look like a Google Drive folder link." };
  }
  let folder;
  try {
    folder = await resolveFolder(id);
  } catch (e) {
    if (e instanceof DriveError) {
      return {
        ok: false,
        message:
          e.code === "not_found"
            ? "Drive can't find that folder from your account. Check the link, and that it isn't in the bin."
            : e.message,
      };
    }
    throw e;
  }

  const supabase = createAdminSupabase();
  const { data: existing, error: readErr } = await supabase
    .from("drive_links")
    .select("position")
    .eq("client_id", clientId)
    .order("position", { ascending: false })
    .limit(1);
  if (isMissingTable(readErr)) return { ok: false, message: RUN_MIGRATION };
  if (readErr) return { ok: false, message: readErr.message };

  // "Client Shared (Portal)" is Kyle's label for the folder, not a name a
  // client should read, so the standard folder gets a plain default.
  const fallback = /client\s*shared/i.test(folder.name) ? "Shared files" : folder.name;
  const { error } = await supabase.from("drive_links").insert({
    client_id: clientId,
    folder_id: folder.id,
    drive_name: folder.name,
    title: title.trim().slice(0, 80) || fallback,
    position: ((existing as { position: number }[] | null)?.[0]?.position ?? -1) + 1,
    created_by: session.clerkUserId,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That folder is already shared with this client." };
    return { ok: false, message: error.message };
  }
  revalidatePath("/admin/clients");
  revalidatePath("/assets");
  return { ok: true };
}

export async function updateDriveLink(
  linkId: string,
  fields: { title?: string; allow_uploads?: boolean },
): Promise<Result> {
  await requireAdmin();
  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) {
    const t = fields.title.trim().slice(0, 80);
    if (!t) return { ok: false, message: "Give the folder a name the client will see." };
    patch.title = t;
  }
  if (fields.allow_uploads !== undefined) patch.allow_uploads = fields.allow_uploads;
  const { error } = await createAdminSupabase().from("drive_links").update(patch).eq("id", linkId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/assets");
  return { ok: true };
}

/** Stop sharing. Nothing in Drive is touched. */
export async function unlinkDriveFolder(linkId: string): Promise<Result> {
  await requireAdmin();
  const { error } = await createAdminSupabase().from("drive_links").delete().eq("id", linkId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/clients");
  revalidatePath("/assets");
  return { ok: true };
}

/**
 * Email everyone on the client account a link straight to the folder, and put
 * the same note in their bell. The link opens the portal: anyone signed out is
 * sent through sign-in and lands on the folder afterwards.
 */
export async function emailDriveLink(linkId: string): Promise<Result<{ sentTo: string[] }>> {
  await requireAdmin();
  const supabase = createAdminSupabase();
  const { data: link } = await supabase
    .from("drive_links")
    .select("id, client_id, title")
    .eq("id", linkId)
    .maybeSingle();
  const row = link as { id: string; client_id: string; title: string } | null;
  if (!row) return { ok: false, message: "That folder is no longer shared." };

  const people = (await resolveRecipients(supabase, row.client_id, null)).filter((p) => p.email);
  if (people.length === 0) {
    return { ok: false, message: "Nobody on this account has an email address yet." };
  }

  const path = drivePagePath(row.id);
  const sentTo: string[] = [];
  const failed: string[] = [];
  for (const p of people) {
    const html = emailLayout(
      "Kyle has shared files with you",
      `<p style="margin:0 0 12px">Hi ${escapeHtml(firstName(p))},</p>
       <p style="margin:0 0 12px">I've shared a folder with you in your Hartwell portal: <strong>${escapeHtml(row.title)}</strong>.</p>
       <p style="margin:0 0 12px">Open it to look through everything, download what you need, or drop files in to send them to me.</p>`,
      "Open the folder",
      path,
    );
    const res = await sendEmail({
      to: p.email as string,
      subject: `Kyle has shared files with you: ${row.title}`,
      html,
      ref: { kind: "other", id: row.id },
    });
    if (res.error) failed.push(p.email as string);
    else sentTo.push(p.email as string);
  }

  // The bell entry is marked as already emailed, so the weekly digest does not
  // announce it a second time.
  const now = new Date().toISOString();
  await supabase.from("notifications").insert(
    people.map((p) => ({
      recipient_user_id: p.clerk_user_id,
      client_id: row.client_id,
      type: "asset_uploaded",
      title: "Kyle shared files with you",
      body: row.title,
      link: path,
      channel: "digest",
      emailed_at: now,
    })),
  );

  if (sentTo.length === 0) {
    return { ok: false, message: `The email didn't send to ${failed.join(", ")}. Try again shortly.` };
  }
  return { ok: true, sentTo };
}

export async function disconnectDrive(): Promise<Result> {
  await requireAdmin();
  try {
    await removeConnection();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not disconnect." };
  }
  revalidatePath("/admin/settings");
  return { ok: true };
}
