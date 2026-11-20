import type { NextRequest } from "next/server";

/** The cookie that ties Google's answer to the browser that asked. */
export const STATE_COOKIE = "draper_gmail_state";

/** The address Google sends Kyle back to; it must be on the OAuth client's list exactly. */
export function callbackUrl(req: NextRequest): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  return `${origin}/api/outreach/gmail/callback`;
}
