import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { oauthClient } from "@/lib/outreach/gmail";
import { calendarAuthUrl } from "@/lib/gcal/google";
import { CAL_STATE_COOKIE, calendarCallbackUrl } from "@/lib/gcal/callback";

export const runtime = "nodejs";

/** "Connect Google Calendar": off to Google to approve the portal's access to admin@'s calendar. */
export async function GET(req: NextRequest) {
  const session = await getPulseSession();
  if (session?.role !== "admin") return new NextResponse("Admins only", { status: 403 });
  const client = oauthClient();
  if (!client) return NextResponse.redirect(new URL("/admin/settings?calendar=error&why=Google+sign-in+isn%27t+set+up+in+Vercel", req.url));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(calendarAuthUrl({ clientId: client.clientId, redirectUri: calendarCallbackUrl(req), state }));
  res.cookies.set(CAL_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google-calendar", maxAge: 600 });
  return res;
}
