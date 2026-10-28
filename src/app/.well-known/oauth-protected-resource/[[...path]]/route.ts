import { CORS, json, originOf, preflight, protectedResourceMetadata } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/**
 * RFC 9728: tells Claude that /api/mcp is protected and where to get a token.
 * Served at the root and at /.well-known/oauth-protected-resource/api/mcp,
 * the two places an MCP client looks.
 */
export function GET(req: Request) {
  return json(protectedResourceMetadata(originOf(req)), 200, { ...CORS, "Cache-Control": "public, max-age=300" });
}

export const OPTIONS = preflight;
