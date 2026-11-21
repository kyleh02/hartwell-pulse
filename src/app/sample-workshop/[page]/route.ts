import { SAMPLE_HEADERS, SAMPLE_PAGES, sampleNotFound, samplePage } from "@/lib/outreach/sample-site";

export const dynamic = "force-dynamic";

/**
 * The sample workshop's other pages. Anything else, Gallery included, is a
 * real 404: the broken menu page the end-to-end test needs.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const known = (SAMPLE_PAGES as readonly string[]).includes(page);
  return known
    ? new Response(samplePage(page as (typeof SAMPLE_PAGES)[number]), { status: 200, headers: SAMPLE_HEADERS })
    : new Response(sampleNotFound(), { status: 404, headers: SAMPLE_HEADERS });
}
