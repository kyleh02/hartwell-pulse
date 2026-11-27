import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { outreachEnabled } from "@/lib/outreach/flag";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReviewDraftBox } from "@/components/outreach/ReviewDraftBox";
import { reviewDraft } from "@/lib/outreach/review-draft";
import { LEAD_WORDS, type LeadWord } from "@/lib/outreach/give-first";
import { gmailThreadUrl } from "@/lib/outreach/replies-rules";
import type { AdsEvidence } from "@/lib/outreach/ads-rules";
import type { TrackingFacts } from "@/lib/outreach/measure-rules";
import type { Fault } from "@/lib/outreach/rules";

export const metadata = { title: "Review draft" };
export const dynamic = "force-dynamic";

/**
 * The free ads review for one business, drafted by Pulse from what it has on
 * record (review-draft.ts), for Kyle to copy, finish and send from kyle@'s
 * Gmail. Nothing here sends.
 */
export default async function ReviewDraftPage({ params }: { params: Promise<{ prospectId: string }> }) {
  if (!outreachEnabled()) notFound();
  const { prospectId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(prospectId)) notFound();
  const supabase = await createServerSupabase();

  const [{ data: p }, { data: contact }, { data: msgs }, { data: events }, { data: runs }] = await Promise.all([
    supabase.from("outreach_prospects").select("id, business_name, domain").eq("id", prospectId).maybeSingle(),
    supabase.from("outreach_contacts").select("first_name").eq("prospect_id", prospectId).maybeSingle(),
    supabase.from("outreach_messages").select("kind, slots, gmail_thread_id, sent_at").eq("prospect_id", prospectId),
    supabase.from("outreach_events").select("detail").eq("prospect_id", prospectId).eq("kind", "checked"),
    supabase
      .from("outreach_measurements")
      .select("url, measured_at, faults, psi_fcp_ms, psi_lcp_ms, pixel_pageviews, menu_links, tracking:raw->tracking")
      .eq("prospect_id", prospectId)
      .eq("status", "ok")
      .order("measured_at", { ascending: false })
      .limit(10),
  ]);
  if (!p) notFound();
  const prospect = p as { id: string; business_name: string | null; domain: string | null };

  type Msg = { kind: string; slots: Record<string, string | null> | null; gmail_thread_id: string | null; sent_at: string | null };
  const first = ((msgs as Msg[] | null) ?? []).find((m) => m.kind === "first");
  const lead = first?.slots?.lead_word;
  const leadWord: LeadWord = (LEAD_WORDS as readonly string[]).includes(lead ?? "") ? (lead as LeadWord) : "enquiries";

  type Ev = { detail: { ads?: AdsEvidence; page_text?: string } | null };
  const newest = (platform: "meta" | "google") =>
    ((events as Ev[] | null) ?? [])
      .filter((e) => e.detail?.ads?.platform === platform)
      .sort((a, b) => b.detail!.ads!.checked_at.localeCompare(a.detail!.ads!.checked_at))[0]?.detail ?? null;
  const meta = newest("meta");
  const google = newest("google");

  type Run = {
    url: string;
    measured_at: string;
    faults: Fault[];
    psi_fcp_ms: number | null;
    psi_lcp_ms: number | null;
    pixel_pageviews: Record<string, number> | null;
    menu_links: { label: string; url: string; status: number | null; blocked: boolean }[] | null;
    tracking: TrackingFacts | null;
  };
  const okRuns = (runs as Run[] | null) ?? [];
  // The newest run with tracking facts, the home page first.
  const isHome = (u: string) => {
    try {
      return new URL(u).pathname.replace(/\/+$/, "") === "";
    } catch {
      return false;
    }
  };
  const run = okRuns.find((r) => r.tracking && isHome(r.url)) ?? okRuns.find((r) => r.tracking) ?? okRuns[0] ?? null;

  const draft = reviewDraft({
    business: first?.slots?.short_name || prospect.business_name || "your business",
    firstName: (contact as { first_name: string | null } | null)?.first_name ?? null,
    domain: prospect.domain,
    leadWord,
    meta: meta?.ads ? { live: meta.ads.live, ads: meta.ads.ads, started: meta.ads.started, pageText: meta.page_text ?? "" } : null,
    google: google?.ads ? { live: google.ads.live, ads: google.ads.ads, lastShown: google.ads.last_shown } : null,
    measurement: run
      ? {
          url: run.url,
          faults: run.faults ?? [],
          lcpMs: run.psi_lcp_ms,
          fcpMs: run.psi_fcp_ms,
          pageviews: Math.max(0, ...Object.values(run.pixel_pageviews ?? {})),
          brokenPages: (run.menu_links ?? []).filter((l) => !l.blocked && l.status !== null && (l.status === 404 || l.status === 410 || l.status >= 500)).map((l) => l.label || l.url),
          tracking: run.tracking ?? null,
        }
      : null,
    today: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date()),
  });
  const threadUrl = first?.gmail_thread_id ? gmailThreadUrl(first.gmail_thread_id) : null;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Review draft: ${prospect.business_name ?? "a business"}`}
        description="Pulse's first draft of the free ads review, from the ad-library checks and the measurements it has on record. The lines in square brackets are yours to write or delete. Copy it into your reply in kyle@'s Gmail, finish it, and send it from there. Nothing here sends."
      />
      <p className="mb-4 text-[13px] text-pulse-text-mute">
        {run ? `Site measured ${new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short" }).format(new Date(run.measured_at))}: ${run.url}.` : "No readable measurement is on record."}{" "}
        <Link href="/admin/outreach?tab=replies" className="text-pulse-gold underline underline-offset-2">
          Back to replies
        </Link>
      </p>
      <ReviewDraftBox subject={draft.subject} body={draft.body} threadUrl={threadUrl} />
    </div>
  );
}
