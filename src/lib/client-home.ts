import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientDashboardData, type DashMetric } from "@/lib/dashboard";
import { formatMoney, isSuperseded, outstandingOf } from "@/lib/invoices-shared";
import { businessToday } from "@/lib/business-time";

/**
 * Everything the client's Home shows, in one load.
 *
 * Home replaced an analytics page that, for a new client, was a heading over an
 * empty box saying their metrics would land soon: the first screen of the
 * relationship was an absence. It now greets them, says how long they have been
 * with Hartwell Digital, and gives every part of the portal a tile carrying its
 * real state, so the whole picture is on one screen and each part is one tap away.
 *
 * Every query filters by client_id explicitly. For a client RLS already scopes
 * them to their own rows; for an admin previewing a client, RLS reads
 * everything, and the filter is what pins the preview to that one client.
 */

export type TileTone = "attention" | "ok" | "neutral";

export interface HomeTile {
  key: "website" | "reports" | "assets" | "approvals" | "copy" | "invoices" | "messages";
  title: string;
  line: string;
  sub: string;
  cta: string;
  href: string;
  /** "attention" is something waiting on the client: an invoice, a change. */
  tone: TileTone;
}

export interface HomeStep {
  key: "signed-in" | "say-hello" | "share-files";
  title: string;
  detail: string;
  done: boolean;
}

export interface ClientHomeData {
  businessName: string;
  firstName: string | null;
  startedOn: string;
  daysWithUs: number;
  /** Still getting set up: any step not done yet. Drives the greeting. */
  isNew: boolean;
  steps: HomeStep[];
  tiles: HomeTile[];
  metrics: DashMetric[];
  metricsMonth: string | null;
  hasConversation: boolean;
}

const DAY = 86_400_000;

/** A timestamp's calendar date where the business is, as YYYY-MM-DD. */
const dateKey = (iso: string) => businessToday(new Date(iso));

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round(
    (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY,
  );
}

/** A date column (YYYY-MM-DD) read as a calendar date, never shifted by a zone. */
function calendar(d: string, withYear = false): string {
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function ago(iso: string, today: string): string {
  const n = daysBetween(dateKey(iso), today);
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 7) return `${n} days ago`;
  return `on ${calendar(dateKey(iso))}`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function snippet(text: string | null, max = 70): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "Sent an attachment";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export async function getClientHome(
  supabase: SupabaseClient,
  clientId: string,
  opts: { firstName?: string | null } = {},
): Promise<ClientHomeData | null> {
  const today = businessToday();
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();

  const [
    clientRes,
    previewsRes,
    reportRes,
    assetsAllRes,
    assetsByClientRes,
    assetsWeekRes,
    copyRes,
    invoicesRes,
    clientMessagesRes,
    lastMessageRes,
    conversationsRes,
    approvalsRes,
    dash,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("business_name, created_at")
      .eq("id", clientId)
      .maybeSingle(),
    supabase
      .from("client_previews")
      .select("title, updated_at")
      .eq("client_id", clientId)
      .eq("visible", true)
      .order("updated_at", { ascending: false }),
    supabase
      .from("reports")
      .select("id, title, published_at")
      .eq("client_id", clientId)
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
    supabase
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("uploader_role", "client"),
    supabase
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gte("created_at", weekAgo),
    supabase
      .from("copy_documents")
      .select("title, status, updated_at")
      .eq("client_id", clientId),
    supabase
      .from("invoices")
      .select("id, invoice_number, total, deposit_amount, due_date, split_at")
      .eq("client_id", clientId)
      .eq("status", "sent"),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("sender_role", "client"),
    supabase
      .from("messages")
      .select("body, sender_role, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .is("deleted_at", null),
    // Sent work only: a draft is Kyle's until he sends it. Missing until
    // migration 0054 runs, which reads as nothing to approve.
    supabase
      .from("approvals")
      .select("id, title, status")
      .eq("client_id", clientId)
      .neq("status", "draft")
      .order("updated_at", { ascending: false }),
    getClientDashboardData(supabase, clientId),
  ]);

  const client = clientRes.data as { business_name: string; created_at: string } | null;
  if (!client) return null;

  const startedKey = dateKey(client.created_at);
  const daysWithUs = Math.max(0, daysBetween(startedKey, today));

  // ---- getting started: ticked by what actually happened, not by a click -----
  const saidHello = (clientMessagesRes.count ?? 0) > 0;
  const sharedFiles = (assetsByClientRes.count ?? 0) > 0;
  const steps: HomeStep[] = [
    {
      key: "signed-in",
      title: "Sign in to your portal",
      detail: "Done. Welcome aboard.",
      done: true,
    },
    {
      key: "say-hello",
      title: "Say hello",
      detail: saidHello
        ? "Done. I've got your message."
        : "Tap the chat bubble, bottom right. It comes straight to me.",
      done: saidHello,
    },
    {
      key: "share-files",
      title: "Share your files",
      detail: sharedFiles
        ? "Done. Thank you."
        : "Logo, photos, documents. Drop them in Assets.",
      done: sharedFiles,
    },
  ];
  const isNew = steps.some((s) => !s.done);

  const tiles: HomeTile[] = [];

  // ---- website: only when there is something to look at ------------------------
  const previews = (previewsRes.data as { title: string; updated_at: string }[] | null) ?? [];
  if (previews.length > 0) {
    tiles.push({
      key: "website",
      title: "Website",
      line:
        previews.length === 1
          ? `${previews[0].title} preview is ready`
          : `${plural(previews.length, "page")} to preview`,
      sub: `Updated ${ago(previews[0].updated_at, today)}`,
      cta: "Have a look",
      href: "/website",
      tone: "neutral",
    });
  }

  // ---- reports ------------------------------------------------------------------
  const report = reportRes.data as
    | { id: string; title: string; published_at: string | null }
    | null;
  tiles.push(
    report
      ? {
          key: "reports",
          title: "Reports",
          line: report.title,
          sub: report.published_at
            ? `Published ${calendar(dateKey(report.published_at))}`
            : "Your latest report",
          cta: "Read it",
          href: `/reports/${report.id}`,
          tone: "neutral",
        }
      : {
          key: "reports",
          title: "Reports",
          line: "No reports yet",
          sub: "Your reports appear here once they're published",
          cta: "See reports",
          href: "/reports",
          tone: "neutral",
        },
  );

  // ---- assets -------------------------------------------------------------------
  const assetCount = assetsAllRes.count ?? 0;
  const addedThisWeek = assetsWeekRes.count ?? 0;
  tiles.push({
    key: "assets",
    title: "Assets",
    line: assetCount > 0 ? plural(assetCount, "file") : "Nothing uploaded yet",
    sub:
      assetCount > 0 && addedThisWeek > 0
        ? `${addedThisWeek} added this week`
        : "Logos, photos, documents",
    cta: assetCount > 0 ? "Open" : "Upload files",
    href: "/assets",
    tone: "neutral",
  });

  // ---- approvals: anything waiting on them leads -----------------------------
  const work = (approvalsRes.data as { id: string; title: string; status: string }[] | null) ?? [];
  const waiting = work.filter((w) => w.status === "waiting");
  const beingChanged = work.filter((w) => w.status === "changes");
  const signedOff = work.filter((w) => w.status === "approved");
  tiles.push(
    waiting.length > 0
      ? {
          key: "approvals",
          title: "Approvals",
          line: waiting.length === 1 ? "1 thing waiting on you" : `${waiting.length} things waiting on you`,
          sub: waiting.length === 1 ? waiting[0].title : `${waiting[0].title}, and more`,
          cta: "Review",
          href: waiting.length === 1 ? `/approvals/${waiting[0].id}` : "/approvals",
          tone: "attention",
        }
      : beingChanged.length > 0
        ? {
            key: "approvals",
            title: "Approvals",
            line: `Kyle is updating ${beingChanged.length === 1 ? beingChanged[0].title : `${beingChanged.length} pieces`}`,
            sub: "With the changes you asked for",
            cta: "Open",
            href: "/approvals",
            tone: "neutral",
          }
        : {
            key: "approvals",
            title: "Approvals",
            line: signedOff.length > 0 ? "All approved" : "Nothing to approve yet",
            sub:
              signedOff.length > 0
                ? `${plural(signedOff.length, "piece")} signed off`
                : "Copy, designs, posts and ads land here for your OK",
            cta: "Open",
            href: "/approvals",
            tone: signedOff.length > 0 ? "ok" : "neutral",
          },
  );

  // ---- copy: only for clients who write their own -----------------------------
  const docs = (copyRes.data as { title: string; status: string; updated_at: string }[] | null) ?? [];
  const byStatus = (s: string) => docs.filter((d) => d.status === s);
  const changes = byStatus("changes_requested");
  const drafts = byStatus("draft");
  const submitted = byStatus("submitted");
  if (docs.length > 0) tiles.push(
    changes.length > 0
      ? {
          key: "copy",
          title: "Copy",
          line: `${plural(changes.length, "document")} ${changes.length === 1 ? "needs" : "need"} changes`,
          sub: changes.length === 1 ? changes[0].title : "Kyle has left notes",
          cta: "Make changes",
          href: "/copy",
          tone: "attention",
        }
      : drafts.length > 0
        ? {
            key: "copy",
            title: "Copy",
            line: `${plural(drafts.length, "draft")} in progress`,
            sub: drafts.length === 1 ? drafts[0].title : "Pick up where you left off",
            cta: "Keep writing",
            href: "/copy",
            tone: "neutral",
          }
        : submitted.length > 0
          ? {
              key: "copy",
              title: "Copy",
              line: `${plural(submitted.length, "document")} with Kyle`,
              sub: "Waiting on Kyle's review",
              cta: "View",
              href: "/copy",
              tone: "neutral",
            }
          : {
              key: "copy",
              title: "Copy",
              line: docs.length > 0 ? "All approved" : "No documents yet",
              sub: docs.length > 0 ? plural(docs.length, "document") : "Draft the words for your site here",
              cta: docs.length > 0 ? "Open" : "Start writing",
              href: "/copy",
              tone: docs.length > 0 ? "ok" : "neutral",
            },
  );

  // ---- invoices: what is actually owed, never a split parent twice ----------
  const owing = (
    (invoicesRes.data as
      | {
          id: string;
          invoice_number: string;
          total: number;
          deposit_amount: number | null;
          due_date: string;
          split_at: string | null;
        }[]
      | null) ?? []
  )
    .filter((i) => !isSuperseded(i))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (owing.length === 0) {
    tiles.push({
      key: "invoices",
      title: "Invoices",
      line: "All paid up",
      sub: "Nothing outstanding",
      cta: "View invoices",
      href: "/invoices",
      tone: "ok",
    });
  } else {
    const next = owing[0];
    const overdue = next.due_date.slice(0, 10) < today;
    tiles.push({
      key: "invoices",
      title: "Invoices",
      line: `${formatMoney(outstandingOf(next))} ${overdue ? "was due" : "due"} ${calendar(next.due_date)}`,
      sub:
        owing.length === 1
          ? next.invoice_number
          : `${next.invoice_number}, and ${plural(owing.length - 1, "other")}`,
      cta: "View invoice",
      href: owing.length === 1 ? `/invoices/${next.id}` : "/invoices",
      tone: "attention",
    });
  }

  // ---- messages -----------------------------------------------------------------
  const last = lastMessageRes.data as
    | { body: string | null; sender_role: string; created_at: string }
    | null;
  tiles.push({
    key: "messages",
    title: "Messages",
    line: last
      ? `${last.sender_role === "admin" ? "Kyle" : "You"}: ${snippet(last.body)}`
      : "Say hello to Kyle",
    sub: last ? `Last message ${ago(last.created_at, today)}` : "Messages go straight to Kyle",
    cta: "Open chat",
    href: "/messages",
    tone: "neutral",
  });

  return {
    businessName: client.business_name,
    firstName: opts.firstName?.trim().split(/\s+/)[0] || null,
    startedOn: calendar(startedKey, true),
    daysWithUs,
    isNew,
    steps,
    tiles,
    metrics: dash.hasData ? dash.summary.slice(0, 4) : [],
    metricsMonth: dash.currentMonthLabel,
    hasConversation: (conversationsRes.count ?? 0) > 0,
  };
}
