import { createAdminSupabase } from "@/lib/supabase/admin";
import { SCOPE, authenticateBearer, originAllowed } from "@/lib/mcp/oauth";
import { json, originOf } from "@/lib/mcp/http";
import { INSTRUCTIONS, TOOLS, callTool } from "@/lib/mcp/pipeline-tools";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Claude's connector to the pipeline: an MCP server over Streamable HTTP
 * (JSON-RPC 2.0, one JSON reply per request, no SSE stream and no session).
 * Hand-written rather than pulled in from the SDK because what it needs is
 * small: initialize, ping, tools/list and tools/call.
 *
 * Public in middleware, because Claude has no Clerk session. The bearer token
 * from /api/oauth/token is the only way in, and a request without a good one
 * gets a 401 naming the metadata that tells Claude how to get one.
 */

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 100_000;

type Msg = { jsonrpc?: unknown; id?: string | number | null; method?: unknown; params?: Record<string, unknown> };

const rpcError = (id: Msg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function POST(req: Request) {
  const origin = originOf(req);
  // DNS rebinding protection, as the transport spec requires.
  if (!originAllowed(req.headers.get("origin"), origin)) return json(rpcError(null, -32600, "Origin not allowed"), 403);
  const version = req.headers.get("mcp-protocol-version");
  if (version && !SUPPORTED.includes(version)) return json(rpcError(null, -32600, `Unsupported MCP-Protocol-Version ${version}`), 400);

  const sb = createAdminSupabase();
  const auth = req.headers.get("authorization");
  const who = await authenticateBearer(sb, auth, origin);
  if (!who) {
    const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="${SCOPE}"${auth ? ', error="invalid_token"' : ""}`;
    return json({ error: auth ? "invalid_token" : "unauthorized" }, 401, { "WWW-Authenticate": challenge });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(rpcError(null, -32600, "Request too large"), 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as Msg[];
  const replies = [];
  for (const m of messages) {
    const r = await handle(m, { sb, origin });
    if (r) replies.push(r);
  }
  // Notifications and responses only: accepted, nothing to say.
  if (!replies.length) return new Response(null, { status: 202 });
  return json(batch ? replies : replies[0]);
}

async function handle(m: Msg, ctx: { sb: ReturnType<typeof createAdminSupabase>; origin: string }) {
  if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return rpcError(m?.id, -32600, "Invalid request");
  if (typeof m.method !== "string") return null; // a response to something we never asked
  if (m.id === undefined) return null; // a notification, e.g. notifications/initialized
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
  const params = (m.params ?? {}) as Record<string, unknown>;

  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "hartwell-pulse", title: "Hartwell Pulse pipeline", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments ?? {};
      if (typeof args !== "object" || Array.isArray(args)) return rpcError(m.id, -32602, "arguments must be an object");
      const res = await callTool(name, args as Record<string, unknown>, ctx);
      if (!res) return rpcError(m.id, -32602, `Unknown tool: ${name}`);
      return ok({ content: [{ type: "text", text: res.text }], isError: !!res.isError });
    }
    default:
      return rpcError(m.id, -32601, `Method not found: ${m.method}`);
  }
}

/** No server-to-client stream is offered, which the transport allows. */
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export const DELETE = GET;
