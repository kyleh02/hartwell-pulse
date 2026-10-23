import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { authorizeUrl, googleConfig } from "@/lib/google-drive";

export const runtime = "nodejs";

/**
 * Start connecting Google Drive: send Kyle to Google to approve access.
 *
 * The state value goes in a short-lived cookie and must come back unchanged
 * with Google's answer, so the callback only accepts an approval this browser
 * actually started.
 */
export async function GET(req: NextRequest) {
  const session = await getPulseSession();
  if (session?.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (!googleConfig()) {
    return NextResponse.redirect(new URL("/admin/settings?drive=not_configured", req.url));
  }
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("pulse_google_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return res;
}
