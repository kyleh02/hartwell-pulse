import { SAMPLE_HEADERS, samplePage } from "@/lib/outreach/sample-site";

export const dynamic = "force-dynamic";

/** The sample workshop's home page (see src/lib/outreach/sample-site.ts). Public, hidden from search. */
export function GET() {
  return new Response(samplePage("home"), { status: 200, headers: SAMPLE_HEADERS });
}
