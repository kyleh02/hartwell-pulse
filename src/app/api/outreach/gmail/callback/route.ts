import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { outreachEnabled } from "@/lib/outreach/flag";
import { exchangeCode, GMAIL_SCOPES, profileEmail, revokeToken, SENDER_EMAIL } from "@/lib/outreach/gmail";
import { saveConnection } from "@/lib/outreach/gmail-access";
import { callbackUrl, STATE_COOKIE } from "@/lib/outreach/gmail-callback";

export const runtime = "nodejs";

function back(req: NextRequest, outcome: string, why?: string) {
  const u = new URL("/admin/outreach", req.url);
  u.searchParams.set("gmail", outcome);
  if (why) u.searchParams.set("why", why.slice(0, 200));
  const res = NextResponse.redirect(u);
  res.cookies.delete({ name: STATE_COOKIE, path: "/api/outreach/gmail" });
  return res;
}

/**
 * Google sends Kyle back here. The state must match the cookie set when he
 * left (so nobody else's approval can be slipped in), the account must be
 * kyle@hartwelldigital.com and both scopes must have been granted. Only then
 * is the refresh token sealed and stored.
 */
export async function GET(req: NextRequest) {
  if (!outreachEnabled()) return new NextResponse("Not found", { status: 404 });
  const session = await getPulseSession();
  if (session?.role !== "admin") return new NextResponse("Admins only", { status: 403 });

  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(req, "error", `Google said: ${q.get("error")}`);
  const state = q.get("state") ?? "";
  const cookie = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const same = state.length > 0 && state.length === cookie.length && timingSafeEqual(Buffer.from(state), Buffer.from(cookie));
  if (!same) return back(req, "error", "The approval didn't match the one this browser started. Try Connect Gmail again.");
  const code = q.get("code");
  if (!code) return back(req, "error", "Google sent no code back.");

  try {
    const t = await exchangeCode(code, callbackUrl(req));
    const email = await profileEmail(t.accessToken);
    if (email !== SENDER_EMAIL) {
      await revokeToken(t.refreshToken);
      return back(req, "error", `That was ${email || "another account"}. Connect ${SENDER_EMAIL}.`);
    }
    const granted = t.scope.split(" ");
    const missing = GMAIL_SCOPES.filter((s) => !granted.includes(s));
    if (missing.length) {
      await revokeToken(t.refreshToken);
      return back(req, "error", "Both Gmail permissions are needed: sending, and reading the threads Draper starts.");
    }
    await saveConnection(createAdminSupabase(), t.refreshToken, granted, session.clerkUserId);
    return back(req, "connected");
  } catch (e) {
    return back(req, "error", e instanceof Error ? e.message : String(e));
  }
}
