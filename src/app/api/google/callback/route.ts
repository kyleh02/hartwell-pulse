import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { DriveError, exchangeCode, saveConnection } from "@/lib/google-drive";

export const runtime = "nodejs";

/** Google sends Kyle back here after he approves (or declines) Drive access. */
export async function GET(req: NextRequest) {
  const back = (outcome: string) => {
    const res = NextResponse.redirect(new URL(`/admin/settings?drive=${outcome}`, req.url));
    res.cookies.delete({ name: "pulse_google_state", path: "/api/google" });
    return res;
  };

  const session = await getPulseSession();
  if (session?.role !== "admin") return NextResponse.redirect(new URL("/", req.url));

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("declined");

  const expected = req.cookies.get("pulse_google_state")?.value ?? "";
  const given = params.get("state") ?? "";
  if (
    !expected ||
    expected.length !== given.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(given))
  ) {
    return back("expired");
  }
  const code = params.get("code");
  if (!code) return back("declined");

  try {
    const { refreshToken, scope, email } = await exchangeCode(code);
    // Google shows Drive as a separate tick box on the consent screen; without
    // it the connection would look fine and every folder would fail.
    if (!scope?.includes("https://www.googleapis.com/auth/drive")) return back("no_drive_scope");
    if (!refreshToken) return back("no_refresh");
    await saveConnection({ refreshToken, email, scopes: scope, connectedBy: session.clerkUserId });
    return back("connected");
  } catch (e) {
    console.error("[google callback]", e);
    return back(e instanceof DriveError ? "failed" : "error");
  }
}
