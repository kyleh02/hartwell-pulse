import { CORS, authorizationServerMetadata, json, originOf, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

/** RFC 8414: the portal's OAuth endpoints, for Claude's connector only. */
export function GET(req: Request) {
  return json(authorizationServerMetadata(originOf(req)), 200, { ...CORS, "Cache-Control": "public, max-age=300" });
}

export const OPTIONS = preflight;
