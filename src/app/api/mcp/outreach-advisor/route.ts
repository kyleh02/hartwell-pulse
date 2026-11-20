import { handleMcp, noStream } from "@/lib/mcp/server";
import { OUTREACH_ADVISOR } from "@/lib/mcp/resources";
import { outreachEnabled } from "@/lib/outreach/flag";
import { ADVISOR_INSTRUCTIONS, callDraperTool, toolsFor, type DraperContext } from "@/lib/outreach/mcp-tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Draper advisor (Stage 7): Draper's tools plus writes to the lessons, the
 * run instructions and the test register, for the advisory chat, used only
 * after Kyle says yes. Its token works here and nowhere else.
 */
export function POST(req: Request) {
  if (!outreachEnabled()) return new Response("Not found", { status: 404 });
  return handleMcp<DraperContext>(req, {
    def: OUTREACH_ADVISOR,
    title: "Draper advisor",
    instructions: ADVISOR_INSTRUCTIONS,
    tools: toolsFor(true),
    call: callDraperTool,
    context: (base) => ({ ...base, advisor: true }),
  });
}

export const GET = noStream;
export const DELETE = noStream;
