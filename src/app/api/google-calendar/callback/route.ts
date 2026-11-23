import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { exchangeCode, revokeToken } from "@/lib/outreach/gmail";
import { accountEmail, CALENDAR_ACCOUNT, CALENDAR_SCOPES } from "@/lib/gcal/google";
import { saveCalendarConnection } from "@/lib/gcal/access";
import { syncCalendar } from "@/lib/gcal/sync";
import { CAL_STATE_COOKIE, calendarCallbackUrl } from "@/lib/gcal/callback";

export const runtime = "nodejs";
export const maxDuration = 60;

function back(req: NextRequest, outcome: string, why?: string) {
  const u = new URL("/admin/settings", req.url);
  u.searchParams.set("calendar", outcome);
  if (why) u.searchParams.set("why", why.slice(0, 200));
  const res = NextResponse.redirect(u);
  res.cookies.delete({ name: CAL_STATE_COOKIE, path: "/api/google-calendar" });
  return res;
}

/**
 * Google sends Kyle back here. The state must match this browser's cookie,
 * the account must be admin@ and the calendar scope granted; only then is the
 * refresh token sealed and stored, and the first sync runs.
 */
export async function GET(req: NextRequest) {
  const session = await getPulseSession();
  if (session?.role !== "admin") return new NextResponse("Admins only", { status: 403 });

  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(req, "error", `Google said: ${q.get("error")}`);
  const state = q.get("state") ?? "";
  const cookie = req.cookies.get(CAL_STATE_COOKIE)?.value ?? "";
  const same = state.length > 0 && state.length === cookie.length && timingSafeEqual(Buffer.from(state), Buffer.from(cookie));
  if (!same) return back(req, "error", "The approval didn't match the one this browser started. Try Connect again.");
  const code = q.get("code");
  if (!code) return back(req, "error", "Google sent no code back.");

  try {
    const t = await exchangeCode(code, calendarCallbackUrl(req));
    const email = await accountEmail(t.accessToken);
    if (email !== CALENDAR_ACCOUNT) {
      await revokeToken(t.refreshToken);
      return back(req, "error", `That was ${email || "another account"}. Connect ${CALENDAR_ACCOUNT}.`);
    }
    const granted = t.scope.split(" ");
    if (!granted.includes(CALENDAR_SCOPES[0])) {
      await revokeToken(t.refreshToken);
      return back(req, "error", "The calendar permission is needed: tick it on Google's screen.");
    }
    const db = createAdminSupabase();
    await saveCalendarConnection(db, email, t.refreshToken, granted, session.clerkUserId);
    const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || req.nextUrl.origin;
    await syncCalendar(db, origin);
    return back(req, "connected");
  } catch (e) {
    return back(req, "error", e instanceof Error ? e.message : String(e));
  }
}
