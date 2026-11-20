import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { outreachEnabled } from "@/lib/outreach/flag";
import { MAX_FIRST_EMAILS_A_DAY, MAX_SENDS_A_DAY, rampCap } from "@/lib/outreach/limits";
import type { DraperSettings, DraperState, Lane, RunInstructions, Template } from "@/lib/outreach/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { NoRepeatTools } from "@/components/outreach/NoRepeatTools";
import { ClientAreas, type AreaRow } from "@/components/outreach/ClientAreas";
import { MeasureSite } from "@/components/outreach/MeasureSite";
import { WordingCheck } from "@/components/outreach/WordingCheck";
import { SendingPanel } from "@/components/outreach/SendingPanel";
import { SettingsForm } from "@/components/outreach/SettingsForm";
import { QueueList, type QueueRow } from "@/components/outreach/QueueList";
import { getPulseSession } from "@/lib/auth/session";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { gmailConnection, type GmailConnection } from "@/lib/outreach/gmail-access";
import { oauthClient } from "@/lib/outreach/gmail";
import { tokenKey } from "@/lib/outreach/crypto";
import { AU_HOLIDAYS, AU_HOLIDAYS_SOURCE } from "@/lib/outreach/data/au-holidays";
import { melbourneDate, melbourneInstant } from "@/lib/outreach/schedule";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Draper" };

/**
 * Draper, Stage 1 (docs/DRAPER.md): what is set up so far, read straight from
 * the tables, and how the rest will fit Pulse as each stage lands. Read-only.
 * Stage 8 replaces this with the Outreach queue, prospect cards, Settings,
 * Lists and Numbers.
 *
 * Reads go through the signed-in user's RLS client, so this page is itself a
 * check that an admin can read every Draper table. A client account never gets
 * here (the admin layout bounces it) and would read nothing if it did.
 */

const MISSING = new Set(["PGRST205", "42P01"]);

/** Claude writes these three; Pulse fills every other {slot}. */
const CLAUDE_SLOTS = new Set(["finding", "why_and_fix", "second_finding"]);

const FLOW: { when: string; what: string; where: string; href?: string }[] = [
  {
    when: "5:30am, weekdays",
    what: "Claude's morning run finds businesses in the active lane, reads their sites and checks each one with Pulse first. Its connector can't send anything.",
    where: "Draper connector",
  },
  {
    when: "Through the day",
    what: "Pulse measures each site itself, checks every claim against its own measurements, checks the wording, and measures each fault again an hour later before it counts.",
    where: "Draper",
  },
  {
    when: "8am",
    what: "The day's queue is fixed and a summary arrives in your notifications. Stop any message, or pause everything, before the first one goes.",
    where: "Notifications and this page",
  },
  {
    when: "9:30am to 3:30pm",
    what: "Pulse sends from kyle@hartwelldigital.com through Gmail: plain text, 20 to 45 minutes apart, one follow-up on day 7 in the same thread.",
    where: "Gmail",
  },
  {
    when: "Every 10 minutes",
    what: "Replies are read. An opt-out is suppressed at once, a reply cancels the follow-up, and everything else waits for your label.",
    where: "This page",
  },
  {
    when: "When they're keen",
    what: "Interested and question replies become leads, source Outreach email, due today. You answer every reply yourself.",
    where: "Pipeline",
    href: "/admin/pipeline",
  },
];

const STAGES: { name: string; what: string }[] = [
  { name: "Data", what: "Every table, admin-only access, the switch that hides Draper" },
  { name: "The no-repeat rule", what: "Fingerprints, do-not-contact by business, the imports" },
  { name: "The measuring tool", what: "PageSpeed, the tags, the six faults, the ABN check" },
  { name: "Submit, verify, check the wording", what: "Pulse fills the figures and refuses what it can't prove" },
  { name: "Sender", what: "Connect Gmail, the window, the warm-up, the 8am summary, test mode" },
  { name: "Replies", what: "Opt-outs, bounces, labels, leads, auto-pause" },
  { name: "The two connectors", what: "Draper and Draper advisor, added in claude.ai" },
  { name: "Pages", what: "The queue, prospect cards, Settings, Lists, Numbers" },
  { name: "End-to-end test", what: "The nine checks in test mode, then your setup list" },
];
const STAGES_DONE = 5;

function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

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

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/40 px-3 py-2.5">
      <p className="text-[11px] text-pulse-text-mute">{label}</p>
      <p className={cn("data-mono mt-0.5 text-sm", warn ? "text-pulse-warn" : "text-pulse-text")}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-pulse-text-mute">{sub}</p>}
    </div>
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
  const years = Object.keys(AU_HOLIDAYS).sort();
  const holidays = years.length ? `${AU_HOLIDAYS_SOURCE}, ${years.join(" and ")}` : "not loaded yet, so nothing can be scheduled";
  const template =
    templates.find((t) => t.version === active?.template_version) ?? templates[templates.length - 1] ?? null;

  return (
    <div>
      <PageHeader
        title="Draper"
        description="Automatic outreach, built in stages. Nothing can send yet: there's no sender, the master switch is off and test mode is on."
      />

      {missing ? (
        <Card className="p-5 text-sm leading-relaxed text-pulse-text-dim">
          Run migration 0062 in the Supabase SQL Editor, then{" "}
          <span className="data-mono text-pulse-text">supabase/probes/0062_draper_probe.sql</span> to
          check it landed.
        </Card>
      ) : errors.length > 0 || !settings ? (
        <Card className="p-5 text-sm leading-relaxed text-pulse-danger">
          Draper&apos;s tables couldn&apos;t be read: {errors[0]?.message ?? "settings version 1 is missing"}.
        </Card>
      ) : (
        <div className="space-y-5">
          {/* ---------- switches ---------- */}
          <Card className="p-4">
            <p className="mono-label mb-3">Switches</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Tile label="Master switch" value={settings.master_on ? "On" : "Off"} warn={settings.master_on} />
              <Tile
                label="Test mode"
                value={settings.test_mode ? "On" : "Off"}
                sub={settings.test_mode ? "Everything goes to your test inboxes" : undefined}
                warn={!settings.test_mode}
              />
              <Tile
                label="Pause all"
                value={state?.paused ? (state.paused_by === "auto" ? "Auto-paused" : "Paused") : "Off"}
                sub={state?.paused ? (state.paused_reason ?? undefined) : undefined}
                warn={!!state?.paused}
              />
              <Tile
                label="Test inboxes"
                value={settings.test_inboxes.length ? `${settings.test_inboxes.length} set` : "None yet"}
                sub="One Gmail, one Outlook, before the test"
              />
              <Tile
                label="First emails a day"
                value={String(settings.daily_first_emails)}
                sub={`Warm-up starts at ${rampCap(0)}. Ceilings: ${MAX_FIRST_EMAILS_A_DAY} first emails, ${MAX_SENDS_A_DAY} sends.`}
              />
              <Tile
                label="Send window"
                value={`${clock(settings.window_start)} to ${clock(settings.window_end)}`}
                sub={`Weekdays, ${settings.gap_min_minutes} to ${settings.gap_max_minutes} minutes apart`}
              />
              <Tile
                label="Stop window"
                value={settings.stop_window_minutes ? `${settings.stop_window_minutes} minutes` : "None"}
                sub="After the 8am summary"
              />
              <Tile label="Pause dates" value={`${day(settings.pause_from)} to ${day(settings.pause_to)}`} />
            </div>
            <p className="data-mono mt-3 text-[11px] text-pulse-text-mute">
              Settings v{settings.version} · template v{template?.version ?? "?"} · run instructions v
              {run?.version ?? "?"} · {prospectsRes.count ?? 0} prospects · {prints.count ?? 0} fingerprints
            </p>
          </Card>

          {/* ---------- the no-repeat rule ---------- */}
          <Card className="p-4">
            <p className="mono-label mb-1">One approach per business, ever</p>
            <p className="mb-3 text-[12px] leading-relaxed text-pulse-text-mute">
              Every business is checked when it&apos;s found, when its email is submitted and again just before
              it sends: against {prints.count ?? 0} fingerprints, the pipeline, your clients, do-not-contact,
              your exclusions and every other prospect. A match on any domain, email, business name, ABN or phone
              blocks it.
            </p>
            <NoRepeatTools />
          </Card>

          {/* ---------- client areas ---------- */}
          <Card className="p-4">
            <p className="mono-label mb-1">Your clients&apos; areas</p>
            <p className="mb-3 text-[12px] leading-relaxed text-pulse-text-mute">
              Draper skips any business offering what a client sells within that client&apos;s radius, so it never
              pitches a competitor down the road. The morning run is never told why. Postcode locations: GeoNames,
              CC BY 4.0.
            </p>
            <ClientAreas areas={areas} clients={clientOptions} />
          </Card>

          {/* ---------- the measuring tool ---------- */}
          <Card className="p-4">
            <p className="mono-label mb-1">Measure a site</p>
            <p className="mb-3 text-[12px] leading-relaxed text-pulse-text-mute">
              What the morning run will ask Pulse for: Google&apos;s phone speed test, ad tracking, HTTPS, the main
              menu&apos;s links and whether the phone number can be tapped.
              {process.env.PAGESPEED_API_KEY ? "" : " PAGESPEED_API_KEY isn't set yet, so the speed test will be refused."}
            </p>
            <MeasureSite />
          </Card>

          {/* ---------- the lint ---------- */}
          <Card className="p-4">
            <p className="mono-label mb-1">Check wording</p>
            <p className="mb-3 text-[12px] leading-relaxed text-pulse-text-mute">
              Every draft passes your rules before it can queue: no dashes, links, prices, meeting asks, promises,
              health claims or American spelling, 60 words a slot, and every figure filled by Pulse from its own
              measurements. Try some wording here; nothing is saved.
            </p>
            <WordingCheck />
          </Card>

          {/* ---------- sending ---------- */}
          <Card className="p-4">
            <p className="mono-label mb-3">Sending</p>
            <SendingPanel
              gmail={gmail}
              setupMissing={setupMissing}
              paused={!!state?.paused}
              pausedReason={state?.paused_reason ?? null}
              tickAt={st?.tick_at ?? null}
              tickNote={st?.tick_note ?? null}
              mode={
                settings.test_mode
                  ? `Test mode: every email goes to ${settings.test_inboxes.join(" or ") || "your test inboxes (none set)"}`
                  : settings.master_on
                    ? "Live: Draper emails businesses"
                    : "Master switch off: nothing sends"
              }
              holidays={holidays}
              flash={one(sp.gmail) ? { outcome: one(sp.gmail)!, why: one(sp.why) } : null}
            />
          </Card>

          <Card className="p-4">
            <p className="mono-label mb-3">Queue</p>
            <QueueList rows={queue} />
          </Card>

          <Card className="p-4">
            <p className="mono-label mb-3">Settings</p>
            <SettingsForm s={settings} />
          </Card>

          {/* ---------- how it fits ---------- */}
          <Card className="p-4">
            <p className="mono-label mb-3">How it will work</p>
            <ol className="space-y-3">
              {FLOW.map((f, i) => (
                <li key={f.when} className="flex gap-3">
                  <span className="data-mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-pulse-gold/40 text-[11px] text-pulse-gold">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-pulse-text">
                      {f.when}{" "}
                      <span className="data-mono text-[11px] text-pulse-text-mute">
                        ·{" "}
                        {f.href ? (
                          <Link href={f.href} className="underline decoration-pulse-border underline-offset-2 hover:text-pulse-gold">
                            {f.where}
                          </Link>
                        ) : (
                          f.where
                        )}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-pulse-text-dim">{f.what}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {/* ---------- lanes ---------- */}
          <Card className="p-4">
            <p className="mono-label mb-3">Lanes</p>
            <ul className="space-y-2.5">
              {lanes.map((l) => (
                <li
                  key={l.id}
                  className="rounded-[var(--radius-input)] border border-pulse-border bg-pulse-surface-2/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-pulse-text">
                        Lane {l.id}: {l.name}
                      </p>
                      <p className="data-mono mt-0.5 text-[11px] text-pulse-text-mute">
                        Template v{l.template_version} · approval {l.approval_required ? "on" : "off"}
                        {l.notes ? ` · ${l.notes}` : ""}
                      </p>
                    </div>
                    <Badge tone={l.active ? "gold" : "neutral"}>{l.active ? "Active" : "Off"}</Badge>
                  </div>
                  {l.services.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {l.services.map((s) => (
                        <span
                          key={s}
                          className="rounded-full border border-pulse-border px-2 py-0.5 text-[11px] text-pulse-text-dim"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  {l.areas.length > 0 && (
                    <p className="mt-2 text-[12px] leading-relaxed text-pulse-text-dim">
                      <span className="text-pulse-text-mute">Areas: </span>
                      {l.areas.join(", ")}
                    </p>
                  )}
                  {l.skip.length > 0 && (
                    <p className="mt-1 text-[12px] leading-relaxed text-pulse-text-dim">
                      <span className="text-pulse-text-mute">Skip: </span>
                      {l.skip.join("; ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {settings.never_list.length > 0 && (
              <p className="mt-3 text-[12px] leading-relaxed text-pulse-text-dim">
                <span className="text-pulse-text-mute">Never, in any lane: </span>
                {settings.never_list.join("; ")}.
              </p>
            )}
            <p className="mt-1.5 text-[12px] text-pulse-text-mute">
              No defence lane: Ironpeak trades in defence under the same ABN.
            </p>
          </Card>

          {/* ---------- the template ---------- */}
          {template && (
            <Card className="p-4">
              <p className="mono-label mb-1">Template v{template.version}</p>
              <p className="mb-3 text-[12px] text-pulse-text-mute">
                <span className="rounded bg-pulse-gold/15 px-1 text-pulse-gold">Gold</span> Claude writes.{" "}
                <span className="rounded bg-pulse-surface-2 px-1 text-pulse-text-dim">Grey</span> Pulse fills from
                its own records.
              </p>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-[var(--radius-input)] border border-pulse-border p-3">
                  <p className="text-[11px] text-pulse-text-mute">First email</p>
                  <p className="mt-1 text-sm text-pulse-text">
                    Subject: <Slotted text={template.first_subject} />
                  </p>
                  <pre className="mt-2 font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text">
                    <Slotted text={template.first_body} />
                  </pre>
                </div>
                <div className="rounded-[var(--radius-input)] border border-pulse-border p-3">
                  <p className="text-[11px] text-pulse-text-mute">Follow-up, day 7, same thread</p>
                  <p className="mt-1 text-sm text-pulse-text">
                    Subject: <Slotted text={template.followup_subject} />
                  </p>
                  <pre className="mt-2 font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text">
                    <Slotted text={template.followup_body} />
                  </pre>
                  <p className="mt-3 text-[12px] leading-relaxed text-pulse-text-dim">
                    <span className="text-pulse-text-mute">Opt-out line in use ({settings.opt_out_line}): </span>
                    {settings.opt_out_line === "B" ? template.opt_out_b : template.opt_out_a}
                  </p>
                </div>
              </div>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-pulse-text-dim hover:text-pulse-text">
                  What Claude is told about the slots
                </summary>
                <pre className="mt-2 font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text-dim">
                  {template.slot_rules}
                </pre>
              </details>
            </Card>
          )}

          {/* ---------- run instructions ---------- */}
          {run && (
            <Card className="p-4">
              <details className="text-sm">
                <summary className="mono-label cursor-pointer">Run instructions v{run.version}</summary>
                <pre className="mt-3 font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pulse-text-dim">
                  {run.body}
                </pre>
              </details>
            </Card>
          )}

          {/* ---------- build progress ---------- */}
          <Card className="p-4">
            <p className="mono-label mb-3">Build</p>
            <ol className="space-y-2">
              {STAGES.map((s, i) => {
                const done = i < STAGES_DONE;
                return (
                  <li key={s.name} className="flex items-start gap-2.5">
                    {done ? (
                      <Check size={15} className="mt-0.5 shrink-0 text-pulse-gold" />
                    ) : (
                      <Circle size={15} className="mt-0.5 shrink-0 text-pulse-text-mute" />
                    )}
                    <p className="text-[13px] leading-snug">
                      <span className={done ? "text-pulse-text" : "text-pulse-text-dim"}>
                        Stage {i + 1}: {s.name}
                      </span>
                      <span className="text-pulse-text-mute"> · {s.what}</span>
                    </p>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}
