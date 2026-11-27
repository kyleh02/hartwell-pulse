import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronRight, Circle } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { outreachEnabled } from "@/lib/outreach/flag";
import type { DraperSettings, DraperState, Lane, RunInstructions, Template } from "@/lib/outreach/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { NoRepeatTools } from "@/components/outreach/NoRepeatTools";
import { ClientAreas, type AreaRow } from "@/components/outreach/ClientAreas";
import { MeasureSite } from "@/components/outreach/MeasureSite";
import { WordingCheck } from "@/components/outreach/WordingCheck";
import { type QueueRow } from "@/components/outreach/QueueList";
import { TodayPanel } from "@/components/outreach/TodayPanel";
import { ModeCard } from "@/components/outreach/ModeCard";
import { SettingsPanel } from "@/components/outreach/SettingsPanel";
import { HashTab } from "@/components/outreach/HashTab";
import { Segmented } from "@/components/outreach/ui";
import type { DraperMode } from "@/app/admin/outreach/sender-actions";
import { FAULT_LABEL } from "@/lib/outreach/rules";
import { RepliesPanel, type LaterRow, type ReplyRow } from "@/components/outreach/RepliesPanel";
import { gmailThreadUrl } from "@/lib/outreach/replies-rules";
import { type ConnectorRow } from "@/components/outreach/DraperConnectors";
import { TestSendButtons } from "@/components/outreach/TestSendButtons";
import { e2eChecklist, type E2EMessage } from "@/lib/outreach/e2e";
import { requestOrigin } from "@/lib/mcp/http";
import { OUTREACH, OUTREACH_ADVISOR, resourceUrl } from "@/lib/mcp/resources";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { gmailConnection, type GmailConnection } from "@/lib/outreach/gmail-access";
import { oauthClient } from "@/lib/outreach/gmail";
import { tokenKey } from "@/lib/outreach/crypto";
import { melbourneDate, melbourneInstant, nationalHolidays } from "@/lib/outreach/schedule";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Draper" };

/**
 * Draper (docs/DRAPER.md). Redesigned on 22 November 2026 at Kyle's request,
 * "simple yet aesthetic, Apple like": a status line, one Off / Test / Live
 * control with Pause all, four figures, then four tabs. Today (what goes out
 * and when, Don't send on each), Replies (label them), Settings (switches
 * that save as they're tapped) and More (the tools he rarely needs).
 *
 * Reads go through the signed-in user's RLS client, so this page is itself a
 * check that an admin can read every Draper table. A client account never gets
 * here (the admin layout bounces it) and would read nothing if it did.
 */

const MISSING = new Set(["PGRST205", "42P01"]);

/** Claude writes these three; Pulse fills every other {slot}. */
const CLAUDE_SLOTS = new Set(["finding", "why_and_fix", "second_finding"]);

function day(d: string | null) {
  if (!d) return "None";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Slotted({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{[a-z_]+\})/g).map((part, i) => {
        const slot = /^\{([a-z_]+)\}$/.exec(part)?.[1];
        if (!slot) return <span key={i}>{part}</span>;
        return (
          <span
            key={i}
            className={cn(
              "rounded px-1",
              CLAUDE_SLOTS.has(slot)
                ? "bg-pulse-gold/15 text-pulse-gold"
                : "bg-pulse-surface-2 text-pulse-text-dim",
            )}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}

export default async function DraperPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!outreachEnabled()) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

  const supabase = await createServerSupabase();
  const [lanesRes, settingsRes, templatesRes, runRes, stateRes, prospectsRes, prints, areasRes, clientsRes] = await Promise.all([
    supabase.from("outreach_lanes").select("*").order("id"),
    supabase.from("outreach_settings").select("*").order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("outreach_templates").select("*").order("version"),
    supabase.from("outreach_run_instructions").select("*").order("version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("outreach_state").select("*").maybeSingle(),
    supabase.from("outreach_prospects").select("id", { count: "exact", head: true }),
    supabase.from("outreach_fingerprints").select("id", { count: "exact", head: true }),
    supabase.from("outreach_client_areas").select("id, client_id, place, postcode, services, radius_km").order("created_at"),
    supabase.from("clients").select("id, business_name, deleted_at").order("business_name"),
  ]);

  const errors = [lanesRes, settingsRes, templatesRes, runRes, stateRes].map((r) => r.error).filter(Boolean);
  const missing = errors.some((e) => MISSING.has(e!.code));

  const lanes = ((lanesRes.data as Lane[] | null) ?? []).sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id);
  const settings = settingsRes.data as DraperSettings | null;
  const templates = (templatesRes.data as Template[] | null) ?? [];
  const run = runRes.data as RunInstructions | null;
  const state = stateRes.data as DraperState | null;
  const active = lanes.find((l) => l.active) ?? null;
  const clientRows = (clientsRes.data as { id: string; business_name: string; deleted_at: string | null }[] | null) ?? [];
  const clientName = new Map(clientRows.map((c) => [c.id, c.business_name]));
  const areas: AreaRow[] = (
    (areasRes.data as { id: string; client_id: string; place: string; postcode: string | null; services: string[]; radius_km: number }[] | null) ?? []
  ).map((a) => ({ ...a, client: clientName.get(a.client_id) ?? "Unknown client" }));
  const clientOptions = clientRows.filter((c) => !c.deleted_at).map((c) => ({ id: c.id, name: c.business_name }));

  // ---------- Stage 5: the sender ----------
  // The Gmail table is service role only; read it only after the admin check.
  const session = await getPulseSession();
  let gmail: GmailConnection | null = null;
  if (session?.role === "admin") gmail = await gmailConnection(createAdminSupabase()).catch(() => null);
  const setupMissing = [
    ...(oauthClient() ? [] : ["GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET"]),
    ...(tokenKey() ? [] : ["OUTREACH_TOKEN_KEY"]),
  ];
  const st = stateRes.data as (DraperState & { tick_at?: string | null; tick_note?: string | null }) | null;
  const todayStart = melbourneInstant(melbourneDate(new Date()), "00:00").toISOString();
  const COLS = "id, prospect_id, kind, status, fault, subject, body, send_on, scheduled_for, sent_at, sent_to, test_mode, past_twelve, checked_at, needs_approval, approved_at";
  const [waitingRes, sentRes] = await Promise.all([
    supabase.from("outreach_messages").select(COLS).in("status", ["awaiting_confirmation", "queued", "sending"]).order("scheduled_for", { nullsFirst: false }).limit(60),
    supabase.from("outreach_messages").select(COLS).eq("status", "sent").gte("sent_at", todayStart).order("sent_at").limit(60),
  ]);
  type QRaw = Omit<QueueRow, "business"> & { prospect_id: string };
  const qRaw = [...((waitingRes.data as QRaw[] | null) ?? []), ...((sentRes.data as QRaw[] | null) ?? [])];
  const pIds = [...new Set(qRaw.map((m) => m.prospect_id))];
  const { data: pNames } = pIds.length
    ? await supabase.from("outreach_prospects").select("id, business_name").in("id", pIds)
    : { data: [] };
  const names = new Map(((pNames as { id: string; business_name: string | null }[] | null) ?? []).map((p) => [p.id, p.business_name]));
  const queue: QueueRow[] = qRaw.map((m) => ({ ...m, business: names.get(m.prospect_id) ?? "A business" }));
  // ---------- Stage 6: replies ----------
  const RCOLS = "id, prospect_id, message_id, kind, quote, label, later_on, received_at, lead_id";
  const fortnight = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [needsRes, recentRes, laterRes] = await Promise.all([
    supabase.from("outreach_replies").select(RCOLS).eq("kind", "reply").is("label", null).order("received_at", { ascending: false }).limit(50),
    supabase.from("outreach_replies").select(RCOLS).neq("kind", "auto_reply").gte("received_at", fortnight).or("label.not.is.null,kind.eq.bounce").order("received_at", { ascending: false }).limit(40),
    supabase.from("outreach_prospects").select("id, business_name, later_on").eq("status", "later").order("later_on").limit(50),
  ]);
  type RRaw = { id: string; prospect_id: string; message_id: string | null; kind: ReplyRow["kind"]; quote: string | null; label: ReplyRow["label"]; later_on: string | null; received_at: string; lead_id: string | null };
  const rRaw = [...((needsRes.data as RRaw[] | null) ?? []), ...((recentRes.data as RRaw[] | null) ?? [])];
  const laterRaw = (laterRes.data as { id: string; business_name: string | null; later_on: string }[] | null) ?? [];
  const rPids = [...new Set([...rRaw.map((r) => r.prospect_id), ...laterRaw.map((l) => l.id)])];
  const [{ data: rNames }, { data: rMsgs }] = rPids.length
    ? await Promise.all([
        supabase.from("outreach_prospects").select("id, business_name").in("id", rPids),
        supabase.from("outreach_messages").select("id, prospect_id, kind, test_mode, gmail_thread_id").in("prospect_id", rPids).eq("status", "sent"),
      ])
    : [{ data: [] }, { data: [] }];
  const rName = new Map(((rNames as { id: string; business_name: string | null }[] | null) ?? []).map((p) => [p.id, p.business_name ?? "A business"]));
  type MRaw = { id: string; prospect_id: string; kind: string; test_mode: boolean | null; gmail_thread_id: string | null };
  const sentMsgs = (rMsgs as MRaw[] | null) ?? [];
  const msgById = new Map(sentMsgs.map((m) => [m.id, m]));
  const firstOf = new Map(sentMsgs.filter((m) => m.kind === "first").map((m) => [m.prospect_id, m]));
  const toRow = (r: RRaw): ReplyRow => {
    const m = (r.message_id ? msgById.get(r.message_id) : undefined) ?? firstOf.get(r.prospect_id);
    return {
      id: r.id,
      business: rName.get(r.prospect_id) ?? "A business",
      kind: r.kind,
      quote: r.quote,
      label: r.label,
      later_on: r.later_on,
      received_at: r.received_at,
      test: !!m?.test_mode,
      thread_url: m?.gmail_thread_id ? gmailThreadUrl(m.gmail_thread_id) : null,
      lead_id: r.lead_id,
      review_url: r.kind === "reply" ? `/admin/outreach/review/${r.prospect_id}` : null,
    };
  };
  const needs = ((needsRes.data as RRaw[] | null) ?? []).map(toRow);
  const recent = ((recentRes.data as RRaw[] | null) ?? []).map(toRow);
  const todayMel = melbourneDate(new Date());
  const laterRows: LaterRow[] = laterRaw.map((l) => {
    const t = firstOf.get(l.id)?.gmail_thread_id;
    return { prospect_id: l.id, business: l.business_name ?? "A business", later_on: l.later_on, due: l.later_on <= todayMel, thread_url: t ? gmailThreadUrl(t) : null };
  });

  // ---------- yield: what the last seven days of runs produced ----------
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: evRows } = await supabase
    .from("outreach_events")
    .select("kind")
    .in("kind", ["found", "submitted", "refused", "confirmed", "dropped", "sent"])
    .gte("at", weekAgo)
    .limit(5000);
  const tally: Record<string, number> = {};
  for (const e of (evRows as { kind: string }[] | null) ?? []) tally[e.kind] = (tally[e.kind] ?? 0) + 1;
  const added = tally.found ?? 0;
  const submitted = tally.submitted ?? 0;
  const yieldLine = added
    ? `Last 7 days: ${added} added, ${submitted} submitted, ${tally.confirmed ?? 0} confirmed, ${tally.dropped ?? 0} dropped, ${tally.refused ?? 0} refused, ${tally.sent ?? 0} sent.${submitted ? ` About ${Math.round(added / submitted)} added for each one submitted.` : " Nothing submitted yet."}`
    : "Last 7 days: no businesses added yet.";

  // ---------- the end-to-end checklist, while test mode is on ----------
  let checklist: ReturnType<typeof e2eChecklist> = [];
  if (settings?.test_mode) {
    const { data: tps } = await supabase.from("outreach_prospects").select("id, business_name").eq("test", true).order("created_at", { ascending: false }).limit(100);
    const tpRows = (tps as { id: string; business_name: string | null }[] | null) ?? [];
    const tIds = tpRows.map((p) => p.id);
    const [{ data: tMsgs }, { data: tReps }] = tIds.length
      ? await Promise.all([
          supabase.from("outreach_messages").select("prospect_id, kind, status, confirmed_at, sent_at, test_mode, subject, body, gmail_thread_id").in("prospect_id", tIds),
          supabase.from("outreach_replies").select("prospect_id, kind, label").in("prospect_id", tIds),
        ])
      : [{ data: [] }, { data: [] }];
    checklist = e2eChecklist(
      tpRows.map((p) => ({ id: p.id, name: p.business_name ?? "A business" })),
      (tMsgs as E2EMessage[] | null) ?? [],
      (tReps as { prospect_id: string; kind: string; label: string | null }[] | null) ?? [],
    );
  }

  // ---------- each morning run's own report (0068) ----------
  const { data: runRows, error: runErr } = await supabase
    .from("outreach_runs")
    .select("id, ran_on, sites_read, added, measured, submitted, dropped, skipped, dropped_reasons, test, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  type RunRow = { id: string; ran_on: string; sites_read: number; added: number; measured: number; submitted: number; dropped: number; skipped: Record<string, number>; dropped_reasons: Record<string, number>; test: boolean; created_at: string };
  const runs = runErr ? [] : ((runRows as RunRow[] | null) ?? []);
  const reasons = (o: Record<string, number>) =>
    Object.entries(o ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");

  // ---------- Stage 7: the two connectors ----------
  const origin = await requestOrigin();
  const conDefs = [
    { def: OUTREACH, what: "For the 5:30am morning run. Add it in claude.ai as a custom connector named Draper." },
    { def: OUTREACH_ADVISOR, what: "For the advisory chat: the same, plus the lessons, run instructions and tests, after you say yes. Add it only when you want it." },
  ];
  let connectors: ConnectorRow[] = conDefs.map(({ def, what }) => ({ scope: def.scope, name: def.name, url: resourceUrl(origin, def), what, connectedSince: null, lastUsed: null }));
  if (session?.role === "admin") {
    const { data: toks } = await createAdminSupabase()
      .from("mcp_tokens")
      .select("resource, kind, created_at, last_used_at")
      .in("resource", connectors.map((c) => c.url))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());
    const rows = (toks as { resource: string; kind: string; created_at: string; last_used_at: string | null }[] | null) ?? [];
    connectors = connectors.map((c) => {
      const mine = rows.filter((r) => r.resource === c.url);
      if (!mine.some((r) => r.kind === "refresh")) return c;
      const since = mine.map((r) => r.created_at).sort()[0] ?? null;
      const used = mine.map((r) => r.last_used_at).filter((x): x is string => !!x).sort().pop() ?? null;
      return { ...c, connectedSince: since, lastUsed: used };
    });
  }

  // Only the big national ones stop sending (Kyle, 20 Nov 2026); say which is next.
  const nowMel = melbourneDate(new Date());
  const nextHoliday = [...nationalHolidays(Number(nowMel.slice(0, 4))), ...nationalHolidays(Number(nowMel.slice(0, 4)) + 1)]
    .filter(([d]) => d >= nowMel)
    .sort(([a], [b]) => a.localeCompare(b))[0];
  const holidays = `sends on them, except New Year's Day, Australia Day, Good Friday, Easter Monday, Anzac Day, Christmas and Boxing Day${
    nextHoliday ? `. Next skipped: ${nextHoliday[1]}, ${new Date(`${nextHoliday[0]}T00:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })}` : ""
  }`;
  const template =
    templates.find((t) => t.version === active?.template_version) ?? templates[templates.length - 1] ?? null;

  // ---------- the page's headline figures and status (Stage 8) ----------
  const mode: DraperMode = settings?.test_mode ? "test" : settings?.master_on ? "live" : "off";
  const nowIso = new Date().toISOString();
  const nextSend = queue
    .filter((r) => r.status === "queued" && r.send_on === todayMel && r.scheduled_for && r.scheduled_for > nowIso && (!r.needs_approval || r.approved_at))
    .map((r) => r.scheduled_for!)
    .sort()[0];
  const sentToday = queue.filter((r) => r.status === "sent").length;
  const waitingFirst = queue.filter((r) => r.kind === "first" && ["awaiting_confirmation", "queued", "sending"].includes(r.status)).length;
  const dueLater = laterRows.filter((l) => l.due).length;
  const tickStale = !st?.tick_at || Date.now() - new Date(st.tick_at).getTime() > 20 * 60_000;
  const atTime = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(" ", "").toLowerCase();
  const statusLine = [
    state?.paused ? "Paused" : mode === "live" ? "Live" : mode === "test" ? "Test mode" : "Off",
    nextSend ? `next email ${atTime(nextSend)}` : waitingFirst ? `${waitingFirst} waiting` : "nothing waiting",
    needs.length ? `${needs.length} repl${needs.length === 1 ? "y" : "ies"} to label` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const tabParam = one(sp.gmail) ? "settings" : one(sp.tab);
  const tab: "today" | "replies" | "settings" | "more" =
    tabParam === "replies" || tabParam === "settings" || tabParam === "more" ? tabParam : "today";

  return (
    <div className="mx-auto max-w-3xl">
      <HashTab />
      <PageHeader title="Draper" description={statusLine} />

      {missing ? (
        <Card className="p-5 text-sm leading-relaxed text-pulse-text-dim">
          Run migration 0062 in the Supabase SQL Editor, then{" "}
          <span className="data-mono text-pulse-text">supabase/probes/0062_draper_probe.sql</span> to check it landed.
        </Card>
      ) : errors.length > 0 || !settings ? (
        <Card className="p-5 text-sm leading-relaxed text-pulse-danger">
          Draper&apos;s tables couldn&apos;t be read: {errors[0]?.message ?? "settings version 1 is missing"}.
        </Card>
      ) : (
        <div className="space-y-6">
          <ModeCard mode={mode} paused={!!state?.paused} pausedReason={state?.paused_reason ?? null} testInboxes={settings.test_inboxes} />

          <div className="grid grid-cols-4 gap-2">
            {[
              { n: sentToday, label: "Sent today" },
              { n: waitingFirst, label: "Waiting" },
              { n: needs.length, label: "To label", warn: needs.length > 0 },
              { n: tally.sent ?? 0, label: "This week" },
            ].map((t) => (
              <div key={t.label} className="rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface px-2 py-3 text-center">
                <p className={cn("data-mono text-[22px] leading-none", t.warn ? "text-pulse-gold" : "text-pulse-text")}>{t.n}</p>
                <p className="mt-1.5 text-[11px] text-pulse-text-mute">{t.label}</p>
              </div>
            ))}
          </div>

          <Segmented
            ariaLabel="Draper"
            value={tab}
            options={[
              { value: "today", label: "Today", href: "/admin/outreach" },
              { value: "replies", label: "Replies", href: "/admin/outreach?tab=replies", count: needs.length },
              { value: "settings", label: "Settings", href: "/admin/outreach?tab=settings" },
              { value: "more", label: "More", href: "/admin/outreach?tab=more" },
            ]}
          />

          {tab === "today" && (
            <div className="space-y-6">
              {(!gmail || tickStale || (state?.faults_off?.length ?? 0) > 0 || dueLater > 0) && (
                <div className="space-y-2">
                  {!gmail && (
                    <Notice tone="warn">
                      Gmail isn&apos;t connected, so nothing can send.{" "}
                      <Link href="/admin/outreach?tab=settings" className="underline underline-offset-2">Connect it in Settings</Link>.
                    </Notice>
                  )}
                  {tickStale && (
                    <Notice tone="warn">
                      {st?.tick_at ? `Pulse last ticked ${atTime(st.tick_at)}` : "Pulse hasn't ticked yet"}: check the cron-job.org job.
                    </Notice>
                  )}
                  {(state?.faults_off?.length ?? 0) > 0 && (
                    <Notice tone="warn">
                      {state!.faults_off.map((f) => FAULT_LABEL[f]).join(", ")} switched off after two &quot;wrong fact&quot; replies.{" "}
                      <Link href="/admin/outreach?tab=replies" className="underline underline-offset-2">Switch back on</Link>.
                    </Notice>
                  )}
                  {dueLater > 0 && (
                    <Notice>
                      {dueLater} &quot;later&quot; {dueLater === 1 ? "card is" : "cards are"} due.{" "}
                      <Link href="/admin/outreach?tab=replies" className="underline underline-offset-2">See them</Link>.
                    </Notice>
                  )}
                </div>
              )}

              {settings.test_mode && (
                <section className="space-y-2">
                  <h3 className="card-title px-1">End-to-end test</h3>
                  <div className="space-y-3 rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface p-4">
                    <ul className="space-y-1.5 text-[13px]">
                      {checklist.map((c) => (
                        <li key={c.key} className="flex items-start gap-2">
                          {c.by ? <Check size={15} className="mt-0.5 shrink-0 text-pulse-gold" /> : <Circle size={15} className="mt-0.5 shrink-0 text-pulse-text-mute" />}
                          <span className={c.by ? "text-pulse-text" : "text-pulse-text-dim"}>
                            {c.label}
                            {c.by && <span className="text-pulse-text-mute"> · {c.by}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <TestSendButtons />
                  </div>
                </section>
              )}

              <TodayPanel rows={queue} today={todayMel} />

              <p className="px-1 text-[12px] leading-relaxed text-pulse-text-mute">
                {st?.tick_at ? `Last tick ${atTime(st.tick_at)}: ${st.tick_note ?? ""}` : ""}
              </p>
            </div>
          )}

          {tab === "replies" && <RepliesPanel needs={needs} recent={recent} later={laterRows} faultsOff={state?.faults_off ?? []} />}

          {tab === "settings" && (
            <SettingsPanel
              s={settings}
              gmail={gmail}
              setupMissing={setupMissing}
              connectors={connectors}
              holidays={holidays}
              flash={one(sp.gmail) ? { outcome: one(sp.gmail)!, why: one(sp.why) } : null}
            />
          )}

          {tab === "more" && (
            <div className="space-y-2">
              <Disclosure title="Morning runs" note={yieldLine} open>
                {runs.length === 0 ? (
                  <p className="text-[13px] text-pulse-text-mute">{runErr ? "Run migration 0068 to keep these." : "No run has reported yet."}</p>
                ) : (
                  <ul className="space-y-2 text-[13px]">
                    {runs.map((r) => (
                      <li key={r.id} className="rounded-[var(--radius-input)] border border-pulse-border p-2.5">
                        <p className="text-pulse-text">
                          {day(r.ran_on)}
                          {r.test && <span className="text-pulse-warn"> · test mode</span>}
                          <span className="text-pulse-text-dim">
                            {" "}
                            · read {r.sites_read}, added {r.added}, measured {r.measured}, submitted {r.submitted}, dropped {r.dropped}
                          </span>
                        </p>
                        {Object.keys(r.skipped ?? {}).length > 0 && <p className="text-[12px] text-pulse-text-mute">Skipped before adding: {reasons(r.skipped)}</p>}
                        {Object.keys(r.dropped_reasons ?? {}).length > 0 && <p className="text-[12px] text-pulse-text-mute">Dropped after measuring: {reasons(r.dropped_reasons)}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Disclosure>

              <Disclosure title="Lanes" note={active ? `Active: ${active.name}` : "No lane is active"}>
                <ul className="space-y-2.5">
                  {lanes.map((l) => (
                    <li key={l.id} className="rounded-[var(--radius-input)] border border-pulse-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-pulse-text">
                          Lane {l.id}: {l.name}
                        </p>
                        <Badge tone={l.active ? "gold" : "neutral"}>{l.active ? "Active" : "Off"}</Badge>
                      </div>
                      {l.services.length > 0 && <p className="mt-1.5 text-[12px] text-pulse-text-dim">{l.services.join(", ")}</p>}
                      {l.areas.length > 0 && <p className="mt-1 text-[12px] text-pulse-text-mute">Areas: {l.areas.join(", ")}</p>}
                      {l.skip.length > 0 && <p className="mt-1 text-[12px] text-pulse-text-mute">Skip: {l.skip.join("; ")}</p>}
                    </li>
                  ))}
                </ul>
                {settings.never_list.length > 0 && <p className="mt-3 text-[12px] text-pulse-text-mute">Never, in any lane: {settings.never_list.join("; ")}.</p>}
              </Disclosure>

              {template && (
                <Disclosure title="The emails" note={`Template v${template.version}: gold is what the run writes; grey Pulse fills in.`}>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-[var(--radius-input)] border border-pulse-border p-3">
                      <p className="text-[12px] text-pulse-text-mute">First email</p>
                      <p className="mt-1 text-sm text-pulse-text">
                        Subject: <Slotted text={template.first_subject} />
                      </p>
                      <pre className="mt-2 font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text">
                        <Slotted text={template.first_body} />
                      </pre>
                    </div>
                    <div className="rounded-[var(--radius-input)] border border-pulse-border p-3">
                      <p className="text-[12px] text-pulse-text-mute">Follow-up, day 7, same thread</p>
                      <pre className="mt-2 font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text">
                        <Slotted text={template.followup_body} />
                      </pre>
                      <p className="mt-3 text-[12px] text-pulse-text-dim">
                        <span className="text-pulse-text-mute">Last line ({settings.opt_out_line}): </span>
                        {settings.opt_out_line === "B" ? template.opt_out_b : template.opt_out_a}
                      </p>
                    </div>
                  </div>
                </Disclosure>
              )}

              {run && (
                <Disclosure title="Run instructions" note={`Version ${run.version}. Changed only through Draper advisor, with your yes.`}>
                  <pre className="font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text-dim">{run.body}</pre>
                </Disclosure>
              )}

              <Disclosure title="Your clients' areas" note="Draper never pitches a business offering what a client sells within that client's radius.">
                <ClientAreas areas={areas} clients={clientOptions} />
              </Disclosure>

              <Disclosure title="One approach per business" note={`${prints.count ?? 0} fingerprints, ${prospectsRes.count ?? 0} prospects. Import lists, or check a business by hand.`}>
                <NoRepeatTools />
              </Disclosure>

              <Disclosure title="Measure a site" note="The same measurement the morning run asks for, shown, not stored.">
                <MeasureSite />
              </Disclosure>

              <Disclosure title="Check wording" note="Try a slot against your rules. Nothing is saved.">
                <WordingCheck />
              </Disclosure>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone?: "warn"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-[var(--radius-input)] border px-3 py-2.5 text-[13px] leading-relaxed",
        tone === "warn" ? "border-pulse-warn/40 bg-pulse-warn/10 text-pulse-text" : "border-pulse-border bg-pulse-surface text-pulse-text-dim",
      )}
    >
      {children}
    </p>
  );
}

/** A section of More: a card that opens, like a phone's settings rows. */
function Disclosure({ title, note, open, children }: { title: string; note?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-[var(--radius-card)] border border-pulse-border bg-pulse-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[15px] text-pulse-text">{title}</span>
          {note && <span className="mt-0.5 block text-[12px] leading-snug text-pulse-text-mute">{note}</span>}
        </span>
        <ChevronRight size={16} className="shrink-0 text-pulse-text-mute transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>
      <div className="border-t border-pulse-border p-4">{children}</div>
    </details>
  );
}
