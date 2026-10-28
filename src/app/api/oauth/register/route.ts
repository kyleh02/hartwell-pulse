import { createAdminSupabase } from "@/lib/supabase/admin";
import { randomToken, redirectAllowed, sha256hex } from "@/lib/mcp/oauth";
import { CORS, json, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/**
 * Dynamic client registration (RFC 7591), which is how Claude introduces
 * itself before asking Kyle for access. Registering grants nothing on its own:
 * every connection still needs Kyle to press Allow while signed in. What it
 * does restrict is where an approval can ever be sent, which is Claude's own
 * hosts or localhost.
 */

const MAX_CLIENTS = 500;
const METHODS = ["none", "client_secret_post", "client_secret_basic"];
const GRANTS = ["authorization_code", "refresh_token"];

const fail = (error: string, description: string) => json({ error, error_description: description }, 400, CORS);

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 10_000) return fail("invalid_client_metadata", "Too large.");
    body = JSON.parse(raw);
  } catch {
    return fail("invalid_client_metadata", "Expected a JSON body.");
  }

  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectAllowed)) {
    return fail("invalid_redirect_uri", "Redirect URIs must be Claude's (claude.ai or claude.com) or localhost.");
  }
  const grants = Array.isArray(body.grant_types) ? (body.grant_types as unknown[]).map(String) : GRANTS;
  if (!grants.every((g) => GRANTS.includes(g))) return fail("invalid_client_metadata", "Only authorization_code and refresh_token are supported.");
  const responses = Array.isArray(body.response_types) ? (body.response_types as unknown[]).map(String) : ["code"];
  if (!responses.every((r) => r === "code")) return fail("invalid_client_metadata", "Only the code response type is supported.");
  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!METHODS.includes(method)) return fail("invalid_client_metadata", `token_endpoint_auth_method must be one of ${METHODS.join(", ")}.`);
  const name = typeof body.client_name === "string" ? body.client_name.trim().slice(0, 100) : "";

  const sb = createAdminSupabase();
  const { count } = await sb.from("mcp_clients").select("client_id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_CLIENTS) return json({ error: "temporarily_unavailable", error_description: "Registration is closed." }, 503, CORS);

  const clientId = randomToken("hpcl");
  const secret = method === "none" ? null : randomToken("hpcs");
  const { error } = await sb.from("mcp_clients").insert({
    client_id: clientId,
    client_name: name || null,
    redirect_uris: uris,
    secret_hash: secret ? sha256hex(secret) : null,
    token_endpoint_auth_method: method,
  });
  if (error) return json({ error: "server_error", error_description: "Could not register." }, 500, CORS);

  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: name || undefined,
      redirect_uris: uris,
      grant_types: grants,
      response_types: ["code"],
      token_endpoint_auth_method: method,
    },
    201,
    CORS,
  );
}

export const OPTIONS = preflight;
