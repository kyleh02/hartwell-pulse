import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { outreachEnabled } from "@/lib/outreach/flag";
import { authUrl, oauthClient } from "@/lib/outreach/gmail";
import { callbackUrl, STATE_COOKIE } from "@/lib/outreach/gmail-callback";

export const runtime = "nodejs";

/** "Connect Gmail": off to Google to approve Draper's access to kyle@ (decision 5). */
export async function GET(req: NextRequest) {
  if (!outreachEnabled()) return new NextResponse("Not found", { status: 404 });
  const session = await getPulseSession();
  if (session?.role !== "admin") return new NextResponse("Admins only", { status: 403 });
  const client = oauthClient();
  if (!client) return NextResponse.redirect(new URL("/admin/outreach?gmail=setup", req.url));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl({ clientId: client.clientId, redirectUri: callbackUrl(req), state }));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/outreach/gmail", maxAge: 600 });
  return res;
}
