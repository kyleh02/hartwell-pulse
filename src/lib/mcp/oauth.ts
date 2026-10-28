import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The portal as an OAuth 2.1 server, for exactly one resource: Claude's
 * connector to the pipeline at /api/mcp (0057). Kyle approves Claude once on
 * /oauth/authorize while signed in as admin; after that Claude holds a token.
 *
 * Deliberately narrow:
 * - Authorization code with PKCE (S256) only. No implicit grant, no password
 *   grant, no client credentials.
 * - Redirects only ever go to Claude (claude.ai, claude.com) or to localhost,
 *   which is where Claude Code listens. A link crafted to send Kyle's approval
 *   anywhere else is refused before he is even asked.
 * - Tokens are random strings stored as SHA-256 hashes, bound to this
 *   resource, short lived (an hour), with refresh tokens rotated on every use.
 * - Every use re-checks that the person behind the token is still an admin.
 */

export const SCOPE = "pipeline";
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 90 * 24 * 60 * 60;
export const CODE_TTL_S = 5 * 60;
/** A refresh token replayed within this window is treated as a retry, not a theft. */
const REPLAY_GRACE_MS = 60_000;

export function mcpResource(origin: string): string {
  return `${origin}/api/mcp`;
}

export function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** RFC 7636: the verifier's SHA-256, base64url, must be the challenge. */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return safeEqual(createHash("sha256").update(verifier).digest("base64url"), challenge);
}

const CLAUDE_HOSTS = ["claude.ai", "claude.com", "anthropic.com"];
const isClaudeHost = (host: string) => CLAUDE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
const isLoopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** Where an approval may be sent: Claude, or Claude Code on this machine. */
export function redirectAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:" && isClaudeHost(u.hostname)) return true;
  return (u.protocol === "http:" || u.protocol === "https:") && isLoopback(u.hostname);
}

export function originAllowed(origin: string | null, own: string): boolean {
  if (!origin) return true;
  if (origin === own) return true;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && isClaudeHost(u.hostname);
  } catch {
    return false;
  }
}

export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  secretHash: string | null;
}

/**
 * A client is either one that registered here (RFC 7591), or a URL naming its
 * own metadata document (Client ID Metadata Documents, the newer MCP way). The
 * second means fetching a URL a stranger supplied, so it is only ever done for
 * Claude's own hosts, with a timeout, no redirects and a size cap.
 */
export async function resolveClient(sb: SupabaseClient, clientId: string): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 500) return null;
  if (clientId.startsWith("https://")) {
    let u: URL;
    try {
      u = new URL(clientId);
    } catch {
      return null;
    }
    if (!isClaudeHost(u.hostname) || u.pathname === "/") return null;
    try {
      const res = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
      if (!res.ok) return null;
      const text = await res.text();
      if (text.length > 20_000) return null;
      const doc = JSON.parse(text) as { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown };
      if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris)) return null;
      const uris = doc.redirect_uris.filter((x): x is string => typeof x === "string");
      return { clientId, name: typeof doc.client_name === "string" ? doc.client_name.slice(0, 100) : u.hostname, redirectUris: uris, secretHash: null };
    } catch {
      return null;
    }
  }
  const { data } = await sb.from("mcp_clients").select("client_id, client_name, redirect_uris, secret_hash").eq("client_id", clientId).maybeSingle();
  const row = data as { client_id: string; client_name: string | null; redirect_uris: string[]; secret_hash: string | null } | null;
  if (!row) return null;
  return { clientId: row.client_id, name: row.client_name || "An app", redirectUris: row.redirect_uris ?? [], secretHash: row.secret_hash };
}

export type AuthorizeParams = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
  resource: string;
};

export function readAuthorizeParams(get: (k: string) => string | null | undefined): AuthorizeParams {
  const v = (k: string) => (get(k) ?? "").toString().slice(0, 2000);
  return {
    response_type: v("response_type"),
    client_id: v("client_id"),
    redirect_uri: v("redirect_uri"),
    code_challenge: v("code_challenge"),
    code_challenge_method: v("code_challenge_method"),
    state: v("state"),
    scope: v("scope"),
    resource: v("resource"),
  };
}

export function withQuery(base: string, q: Record<string, string>): string {
  const u = new URL(base);
  for (const [k, val] of Object.entries(q)) if (val) u.searchParams.set(k, val);
  return u.toString();
}

export type AuthorizeCheck =
  | { kind: "ok"; client: OAuthClient; resource: string }
  /** Something about the client or redirect is wrong: say so, never redirect. */
  | { kind: "show"; message: string }
  /** The redirect is trusted but the request is not: hand the error back to Claude. */
  | { kind: "redirect"; url: string };

/**
 * Everything an authorization request must satisfy, in the order OAuth says to
 * check it. Run on the consent page AND again when Allow is pressed, because a
 * form is only what the browser chose to send back.
 */
export async function checkAuthorize(sb: SupabaseClient, p: AuthorizeParams, origin: string): Promise<AuthorizeCheck> {
  const client = await resolveClient(sb, p.client_id);
  if (!client) return { kind: "show", message: "This connection request came from an app the portal doesn't know. Start again from Claude." };
  if (!p.redirect_uri || !client.redirectUris.includes(p.redirect_uri) || !redirectAllowed(p.redirect_uri)) {
    return { kind: "show", message: "This connection request would send your approval somewhere other than Claude, so it has been stopped." };
  }
  const back = (error: string, description: string) => ({
    kind: "redirect" as const,
    url: withQuery(p.redirect_uri, { error, error_description: description, state: p.state, iss: origin }),
  });
  if (p.response_type !== "code") return back("unsupported_response_type", "Only the authorization code flow is supported.");
  if (!p.code_challenge || p.code_challenge_method !== "S256") return back("invalid_request", "PKCE with S256 is required.");
  if (p.scope && !p.scope.split(/\s+/).every((s) => s === SCOPE)) return back("invalid_scope", `The only scope is "${SCOPE}".`);
  const resource = mcpResource(origin);
  if (p.resource && p.resource.replace(/\/$/, "") !== resource && p.resource.replace(/\/$/, "") !== origin) {
    return back("invalid_target", "This server only issues tokens for its own MCP endpoint.");
  }
  return { kind: "ok", client, resource };
}

/** The approval, as a single-use code good for five minutes. */
export async function createCode(
  sb: SupabaseClient,
  args: { client: OAuthClient; userId: string; redirectUri: string; codeChallenge: string; resource: string },
): Promise<string> {
  const code = randomToken("hpc");
  const { error } = await sb.from("mcp_codes").insert({
    code_hash: sha256hex(code),
    client_id: args.client.clientId,
    client_name: args.client.name,
    user_id: args.userId,
    redirect_uri: args.redirectUri,
    code_challenge: args.codeChallenge,
    scope: SCOPE,
    resource: args.resource,
    family: randomUUID(),
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

export interface TokenPair {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function issueTokens(
  sb: SupabaseClient,
  a: { clientId: string; clientName: string | null; userId: string; resource: string; family: string },
): Promise<TokenPair> {
  const access = randomToken("hpa");
  const refresh = randomToken("hpr");
  const now = Date.now();
  const base = { client_id: a.clientId, client_name: a.clientName, user_id: a.userId, scope: SCOPE, resource: a.resource, family: a.family };
  const { error } = await sb.from("mcp_tokens").insert([
    { ...base, token_hash: sha256hex(access), kind: "access", expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
    { ...base, token_hash: sha256hex(refresh), kind: "refresh", expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
  ]);
  if (error) throw new Error(error.message);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
}

export async function revokeFamily(sb: SupabaseClient, family: string) {
  await sb.from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("family", family).is("revoked_at", null);
}

export async function isAdminUser(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await sb.from("client_users").select("role").eq("clerk_user_id", userId).maybeSingle();
  return (data as { role: string } | null)?.role === "admin";
}

type TokenRow = {
  kind: string;
  client_id: string;
  client_name: string | null;
  user_id: string;
  resource: string;
  family: string;
  expires_at: string;
  revoked_at: string | null;
};

/** The person and app behind an MCP request, or null for a 401. */
export async function authenticateBearer(sb: SupabaseClient, header: string | null, origin: string): Promise<{ userId: string; clientId: string } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!m) return null;
  const hash = sha256hex(m[1]);
  const { data } = await sb
    .from("mcp_tokens")
    .select("kind, client_id, client_name, user_id, resource, family, expires_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  const t = data as TokenRow | null;
  if (!t || t.kind !== "access" || t.revoked_at || new Date(t.expires_at).getTime() <= Date.now()) return null;
  // Audience: a token is only good for the resource it was issued for.
  if (t.resource !== mcpResource(origin)) return null;
  if (!(await isAdminUser(sb, t.user_id))) return null;
  await sb.from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("token_hash", hash);
  return { userId: t.user_id, clientId: t.client_id };
}

export type TokenError = { error: string; error_description: string; status?: number };

/** The token endpoint's two grants. Returns tokens or an RFC 6749 error. */
export async function exchange(
  sb: SupabaseClient,
  form: Record<string, string>,
  origin: string,
  basicAuth: { id: string; secret: string } | null,
): Promise<TokenPair | TokenError> {
  const clientId = basicAuth?.id || form.client_id || "";
  const client = await resolveClient(sb, clientId);
  if (!client) return { error: "invalid_client", error_description: "Unknown client.", status: 401 };
  if (client.secretHash) {
    const secret = basicAuth?.secret ?? form.client_secret ?? "";
    if (!secret || !safeEqual(sha256hex(secret), client.secretHash)) {
      return { error: "invalid_client", error_description: "Client authentication failed.", status: 401 };
    }
  }
  const resource = mcpResource(origin);
  if (form.resource && form.resource.replace(/\/$/, "") !== resource && form.resource.replace(/\/$/, "") !== origin) {
    return { error: "invalid_target", error_description: "This server only issues tokens for its own MCP endpoint." };
  }

  if (form.grant_type === "authorization_code") {
    const hash = sha256hex(form.code ?? "");
    const { data } = await sb.from("mcp_codes").select("*").eq("code_hash", hash).maybeSingle();
    const c = data as {
      client_id: string;
      client_name: string | null;
      user_id: string;
      redirect_uri: string;
      code_challenge: string;
      resource: string;
      family: string;
      expires_at: string;
      used_at: string | null;
    } | null;
    if (!c) return { error: "invalid_grant", error_description: "Unknown or expired code." };
    if (c.used_at) {
      // A code used twice means someone else may hold it: end what it started.
      await revokeFamily(sb, c.family);
      return { error: "invalid_grant", error_description: "That code has already been used." };
    }
    if (new Date(c.expires_at).getTime() <= Date.now()) return { error: "invalid_grant", error_description: "That code has expired." };
    if (c.client_id !== client.clientId) return { error: "invalid_grant", error_description: "That code was issued to another client." };
    if ((form.redirect_uri ?? "") !== c.redirect_uri) return { error: "invalid_grant", error_description: "redirect_uri does not match." };
    if (!pkceOk(form.code_verifier ?? "", c.code_challenge)) return { error: "invalid_grant", error_description: "PKCE verification failed." };
    // Claim it: of two simultaneous exchanges, only one finds used_at still null.
    const { data: claimed } = await sb
      .from("mcp_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code_hash", hash)
      .is("used_at", null)
      .select("code_hash");
    if (!claimed?.length) return { error: "invalid_grant", error_description: "That code has already been used." };
    if (!(await isAdminUser(sb, c.user_id))) return { error: "invalid_grant", error_description: "That account can no longer connect." };
    return issueTokens(sb, { clientId: c.client_id, clientName: c.client_name, userId: c.user_id, resource: c.resource, family: c.family });
  }

  if (form.grant_type === "refresh_token") {
    const hash = sha256hex(form.refresh_token ?? "");
    const { data } = await sb
      .from("mcp_tokens")
      .select("kind, client_id, client_name, user_id, resource, family, expires_at, revoked_at")
      .eq("token_hash", hash)
      .maybeSingle();
    const t = data as TokenRow | null;
    if (!t || t.kind !== "refresh") return { error: "invalid_grant", error_description: "Unknown refresh token." };
    if (t.client_id !== client.clientId) return { error: "invalid_grant", error_description: "That token was issued to another client." };
    if (t.revoked_at) {
      // Replayed after rotation. A quick retry is a network hiccup; anything
      // later looks like a copy in someone else's hands, so end the chain.
      if (Date.now() - new Date(t.revoked_at).getTime() > REPLAY_GRACE_MS) await revokeFamily(sb, t.family);
      return { error: "invalid_grant", error_description: "That refresh token has been used." };
    }
    if (new Date(t.expires_at).getTime() <= Date.now()) return { error: "invalid_grant", error_description: "That refresh token has expired." };
    const { data: claimed } = await sb
      .from("mcp_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hash)
      .is("revoked_at", null)
      .select("token_hash");
    if (!claimed?.length) return { error: "invalid_grant", error_description: "That refresh token has been used." };
    if (!(await isAdminUser(sb, t.user_id))) {
      await revokeFamily(sb, t.family);
      return { error: "invalid_grant", error_description: "That account can no longer connect." };
    }
    return issueTokens(sb, { clientId: t.client_id, clientName: t.client_name, userId: t.user_id, resource: t.resource, family: t.family });
  }

  return { error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token." };
}
