import { handleMcp, noStream } from "@/lib/mcp/server";
import { OUTREACH } from "@/lib/mcp/resources";
import { outreachEnabled } from "@/lib/outreach/flag";
import { DRAPER_INSTRUCTIONS, callDraperTool, toolsFor, type DraperContext } from "@/lib/outreach/mcp-tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A measurement takes 15 to 40 seconds.
export const maxDuration = 60;

/**
 * Draper, the morning run's connector (Stage 7). Its token works here and
 * nowhere else: not at /api/mcp, not at the advisor. It can't send, see
 * clients, invoices or the exclusions, delete, or move or win a lead.
 */
export function POST(req: Request) {
  if (!outreachEnabled()) return new Response("Not found", { status: 404 });
  return handleMcp<DraperContext>(req, {
    def: OUTREACH,
    title: "Draper",
    instructions: DRAPER_INSTRUCTIONS,
    tools: toolsFor(false),
    call: callDraperTool,
    context: (base) => ({ ...base, advisor: false }),
  });
}

export const GET = noStream;
export const DELETE = noStream;
