import { CORS, json, originOf, preflight, protectedResourceMetadata } from "@/lib/mcp/http";
import { resourceForMetadataPath } from "@/lib/mcp/resources";
import { outreachEnabled } from "@/lib/outreach/flag";

export const dynamic = "force-dynamic";

/**
 * RFC 9728: tells Claude that a connector address is protected and where to
 * get a token. The root and /api/mcp describe the pipeline connector; with
 * Draper on, /api/mcp/outreach and /api/mcp/outreach-advisor describe
 * Draper's two, each with its own scope. Anything else is a 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const def = resourceForMetadataPath(path, outreachEnabled());
  if (!def) return json({ error: "not_found" }, 404, CORS);
  return json(protectedResourceMetadata(originOf(req), def), 200, { ...CORS, "Cache-Control": "public, max-age=300" });
}

export const OPTIONS = preflight;
