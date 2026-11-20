import { handleMcp, noStream } from "@/lib/mcp/server";
import { PIPELINE } from "@/lib/mcp/resources";
import { INSTRUCTIONS, TOOLS, callTool } from "@/lib/mcp/pipeline-tools";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Claude's connector to the pipeline (0057). The transport and the token
 * check are shared with Draper's connectors in src/lib/mcp/server.ts; a token
 * issued for any other address is refused here.
 */
export function POST(req: Request) {
  return handleMcp(req, {
    def: PIPELINE,
    title: "Hartwell Pulse pipeline",
    instructions: INSTRUCTIONS,
    tools: TOOLS,
    call: (name, args, ctx) => callTool(name, args, { sb: ctx.sb, origin: ctx.origin }),
  });
}

export const GET = noStream;
export const DELETE = noStream;
