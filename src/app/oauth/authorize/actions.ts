"use server";

import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { checkAuthorize, createCode, readAuthorizeParams, withQuery, type AuthorizeParams } from "@/lib/mcp/oauth";
import { requestOrigin } from "@/lib/mcp/http";

/**
 * Kyle's answer on the consent page. Everything is checked again from the
 * start: the form is only what the browser sent back, and the page it came
 * from may be minutes old. Server actions also refuse a cross-site post,
 * which is what stops another site submitting Allow on Kyle's behalf.
 */
export async function decideConnector(input: AuthorizeParams, allow: boolean): Promise<{ url: string } | { message: string }> {
  const session = await getPulseSession();
  if (session?.role !== "admin") return { message: "Only Kyle's admin account can connect Claude to the pipeline." };
  const origin = await requestOrigin();
  const sb = createAdminSupabase();
  const p = readAuthorizeParams((k) => {
    const v = (input as Record<string, unknown>)[k];
    return typeof v === "string" ? v : null;
  });
  const check = await checkAuthorize(sb, p, origin);
  if (check.kind === "show") return { message: check.message };
  if (check.kind === "redirect") return { url: check.url };
  if (!allow) {
    return { url: withQuery(p.redirect_uri, { error: "access_denied", error_description: "Kyle declined the connection.", state: p.state, iss: origin }) };
  }
  const code = await createCode(sb, {
    client: check.client,
    userId: session.clerkUserId,
    redirectUri: p.redirect_uri,
    codeChallenge: p.code_challenge,
    resource: check.resource,
  });
  return { url: withQuery(p.redirect_uri, { code, state: p.state, iss: origin }) };
}
