import "server-only";
import { NextResponse } from "next/server";
import { getPulseSession, type PulseSession } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { DriveError } from "@/lib/google-drive";

export interface DriveLinkRow {
  id: string;
  client_id: string;
  folder_id: string;
  drive_name: string | null;
  title: string;
  allow_uploads: boolean;
  position: number;
}

/**
 * The linked folder a request names, read AS the signed-in person.
 *
 * RLS decides: a client gets only their own rows, an admin gets any. The
 * client_id is compared again here as well, because this row is the root of
 * everything a Drive request may reach and a policy typo should not be the
 * only thing standing in front of Kyle's Drive.
 */
export async function linkForRequest(
  linkId: string | null,
): Promise<{ link: DriveLinkRow; session: PulseSession } | NextResponse> {
  const session = await getPulseSession();
  if (!session || (session.role !== "admin" && session.role !== "client")) {
    return NextResponse.json({ error: "signed_out", message: "Please sign in again." }, { status: 401 });
  }
  if (!linkId || !/^[0-9a-f-]{36}$/i.test(linkId)) {
    return NextResponse.json({ error: "not_found", message: "That folder link is not valid." }, { status: 404 });
  }
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("drive_links")
    .select("id, client_id, folder_id, drive_name, title, allow_uploads, position")
    .eq("id", linkId)
    .maybeSingle();
  const link = data as DriveLinkRow | null;
  if (!link || (session.role === "client" && link.client_id !== session.clientId)) {
    return NextResponse.json({ error: "not_found", message: "This folder is no longer shared." }, { status: 404 });
  }
  return { link, session };
}

/**
 * A Drive failure as the person asking should hear it. Kyle gets the real
 * reason, because it is usually his to fix in Settings. A client gets a plain
 * sentence, because "invalid_grant" is not theirs to act on.
 */
export function driveFailure(e: unknown, role: "admin" | "client" | null): NextResponse {
  if (!(e instanceof DriveError)) {
    console.error("[drive]", e);
    return NextResponse.json(
      { error: "google", message: "Something went wrong reaching Google Drive. Try again in a moment." },
      { status: 502 },
    );
  }
  const status =
    e.code === "not_found"
      ? 404
      : e.code === "forbidden"
        ? 403
        : e.code === "too_large"
          ? 413
          : e.code === "google"
            ? 502
            : 503;
  const setupProblem = e.code === "not_configured" || e.code === "not_connected" || e.code === "reconnect";
  const message =
    role === "admin" || e.code === "forbidden"
      ? e.message
      : setupProblem || e.code === "not_found"
        ? "These files aren't available right now. Try again soon, or message Kyle."
        : e.message;
  return NextResponse.json({ error: e.code, message }, { status });
}
