import "server-only";
import type { McpTool, McpToolContext } from "@/lib/mcp/server";
import { checkBusiness } from "./check.ts";
import { publicVerdict } from "./match.ts";
import { lookupAbn } from "./abr.ts";
import { onOwnSite } from "./contact.ts";
import { measureSite, siteUrl } from "./measure.ts";
import { storeMeasurement } from "./store.ts";
import { qualifies } from "./measure-rules.ts";
import { submitDraft } from "./submit.ts";
import { lookupMxProvider } from "./mx.ts";
import { normaliseAbn, normaliseDomain, normaliseEmail } from "./normalise.ts";
import { pageNamesFor, secondsWords, TOKEN_GUIDE } from "./tokens.ts";
import { SLOTS, type SlotName } from "./lint.ts";
import { firstEmailCap, firstEmailsToday, MAX_FIRST_EMAILS_A_DAY } from "./limits.ts";
import { addDays, calendar, melbourneDate, melbourneInstant, nextSendingDay } from "./schedule.ts";
import { applyLabel } from "./replies.ts";
import { LABEL_TEXT, isReplyLabel } from "./replies-rules.ts";
import { AU_STATES, FAULT_LABEL, FAULTS, type Fault } from "./rules.ts";
import type { DraperSettings, Lane } from "./types.ts";

/**
 * Draper's connector tools (Stage 7, the brief's section 7): what the 5:30am
 * morning run can do, through /api/mcp/outreach, and the same plus three
 * writes for the advisory chat through /api/mcp/outreach-advisor.
 *
 * What it CAN'T do is the point:
 *   - send anything: Pulse sends, on its own clock, after its own checks;
 *   - see clients, invoices or Kyle's exclusions: a business check answers
 *     allowed or blocked, with no reason at all for his private lists;
 *   - delete anything, or move or win a lead: the only pipeline write is a
 *     new lead from a reply labelled interested or question, through the
 *     same applyLabel() Kyle's own buttons use;
 *   - write a figure: every number, day and page name in an email is a token
 *     Pulse fills from its own measurements (tokens.ts).
 *
 * Results are plain text for the model to read, with ids for the next call.
 */

export type DraperContext = McpToolContext & { advisor: boolean };
type Tool = McpTool<DraperContext> & { advisorOnly?: boolean };
type Args = Record<string, unknown>;

class InputError extends Error {}

const ACTOR = "claude";
/** Bounds on one run, whatever it's told. */
const MAX_ADDS_A_DAY = 100;
const MAX_MEASURES_PER_PROSPECT = 4;

function str(a: Args, k: string, max = 2000): string | undefined {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new InputError(`${k} must be text.`);
  return v.trim().slice(0, max);
}
function need(a: Args, k: string, max = 2000): string {
  const v = str(a, k, max);
  if (!v) throw new InputError(`${k} is required.`);
  return v;
}
function int(a: Args, k: string): number | undefined {
  const v = a[k];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new InputError(`${k} must be a whole number.`);
  return v;
}
function list(a: Args, k: string): string[] {
  const v = a[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new InputError(`${k} must be a list of text.`);
  return (v as string[]).map((x) => x.trim().slice(0, 100)).filter(Boolean).slice(0, 20);
}
const ID = { type: "string", description: "The prospect's id, from outreach_add_prospect." };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function settingsOf(ctx: DraperContext): Promise<DraperSettings> {
  const { data, error } = await ctx.sb.from("outreach_settings").select("*").order("version", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error(`Draper's settings couldn't be read: ${error?.message ?? "none"}`);
  return data as DraperSettings;
}

async function activeLane(ctx: DraperContext): Promise<Lane | null> {
  const { data } = await ctx.sb.from("outreach_lanes").select("*").eq("active", true).maybeSingle();
  return data as Lane | null;
}

async function prospectOf(ctx: DraperContext, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new InputError("prospect_id isn't an id from outreach_add_prospect.");
  const { data } = await ctx.sb
    .from("outreach_prospects")
    .select("id, business_name, domain, website_url, status, suburb, postcode, lane_id, test")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new InputError("No prospect with that id.");
  return data as { id: string; business_name: string | null; domain: string | null; website_url: string | null; status: string; suburb: string | null; postcode: string | null; lane_id: number | null; test: boolean };
}

async function event(ctx: DraperContext, prospectId: string | null, kind: string, detail: Record<string, unknown> = {}) {
  await ctx.sb.from("outreach_events").insert({ prospect_id: prospectId, kind, actor: ACTOR, detail });
}

// ---------- what the next sending day needs ----------

async function target(ctx: DraperContext, s: DraperSettings): Promise<{ day: string | null; cap: number; waiting: number; target: number; why: string | null }> {
  const today = melbourneDate(new Date());
  const cal = calendar(s.pause_from, s.pause_to, s.send_weekends === true);
  const day = nextSendingDay(today, null, cal);
  const { data: st } = await ctx.sb.from("outreach_state").select("paused, paused_reason").maybeSingle();
  const state = st as { paused: boolean; paused_reason: string | null } | null;
  const [{ data: sent }, { count: waiting }, { count: fus }] = await Promise.all([
    ctx.sb.from("outreach_messages").select("sent_at").eq("kind", "first").eq("test_mode", false).not("sent_at", "is", null),
    ctx.sb.from("outreach_messages").select("id", { count: "exact", head: true }).eq("kind", "first").in("status", ["awaiting_confirmation", "queued"]),
    day
      ? ctx.sb.from("outreach_messages").select("id", { count: "exact", head: true }).eq("kind", "follow_up").eq("status", "queued").eq("send_on", day)
      : Promise.resolve({ count: 0 }),
  ]);
  const daysDone = new Set(((sent as { sent_at: string }[] | null) ?? []).map((r) => melbourneDate(new Date(r.sent_at)))).size;
  const cap = firstEmailsToday(firstEmailCap(s.daily_first_emails, daysDone), fus ?? 0);
  const w = waiting ?? 0;
  let why: string | null = null;
  if (state?.paused) why = `Sending is paused (${state.paused_reason ?? "by Kyle"})`;
  else if (!s.test_mode && !s.master_on) why = "The master switch is off and test mode is off, so nothing can send";
  else if (!day) why = "There's no sending day ahead: no public holiday dates are loaded for it, or it's in the pause dates";
  return { day, cap, waiting: w, target: why ? 0 : Math.max(0, cap - w), why };
}

// ---------- the tools ----------

const SUBMIT_SLOTS = Object.fromEntries(SLOTS.map((s) => [s, { type: "string" }]));

export const DRAPER_TOOLS: Tool[] = [
  {
    name: "outreach_brief",
    title: "Today's brief",
    description:
      "Call this first, every run. Today's date, the mode, how many businesses the next sending day still needs (the target: stop when it's met), the active lane, the template and its slot rules, how tokens work, faults switched off, the lessons, the live test and the run instructions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(_a, ctx) {
      const s = await settingsOf(ctx);
      const [lane, t, { data: st }, { data: run }, { data: lessons }, { data: test }, { count: toLabel }] = await Promise.all([
        activeLane(ctx),
        target(ctx, s),
        ctx.sb.from("outreach_state").select("faults_off").maybeSingle(),
        ctx.sb.from("outreach_run_instructions").select("version, body").order("version", { ascending: false }).limit(1).maybeSingle(),
        ctx.sb.from("outreach_lessons").select("version, body").order("version", { ascending: false }).limit(1).maybeSingle(),
        ctx.sb.from("outreach_tests").select("id, question, version_a, version_b, started_on, ends_after").eq("status", "live").maybeSingle(),
        ctx.sb.from("outreach_replies").select("id", { count: "exact", head: true }).eq("kind", "reply").is("label", null),
      ]);
      const tv = lane?.template_version ?? 1;
      const { data: tpl } = await ctx.sb.from("outreach_templates").select("*").eq("version", tv).maybeSingle();
      const template = tpl as { version: number; first_subject: string; first_body: string; followup_subject: string; followup_body: string; slot_rules: string } | null;
      const off = ((st as { faults_off: Fault[] } | null)?.faults_off ?? []) as Fault[];
      const today = melbourneDate(new Date());
      const mode = s.test_mode ? "TEST MODE: every email goes to Kyle's test inboxes, never to the business" : s.master_on ? "LIVE: emails go to the businesses" : "OFF: nothing sends";
      const r = run as { version: number; body: string } | null;
      const l = lessons as { version: number; body: string } | null;
      const lt = test as { id: string; question: string; version_a: string; version_b: string; started_on: string | null; ends_after: number | null } | null;
      return {
        text: [
          `Today in Melbourne: ${today}. Mode: ${mode}.`,
          t.day ? `The next sending day is ${t.day}. What you submit today is checked again an hour after its first measurement and, if it holds, sends then.` : "There's no sending day ahead.",
          t.why
            ? `TARGET: 0. ${t.why}. Don't look for businesses today; only label replies.`
            : `TARGET: ${t.target} new businesses to submit (the day takes ${t.cap}, ${t.waiting} already waiting). Stop when it's met. Never more than ${MAX_FIRST_EMAILS_A_DAY} a day, whatever you're told.`,
          toLabel ? `${toLabel} repl${toLabel === 1 ? "y waits" : "ies wait"} for a label: outreach_replies_to_label.` : "No replies wait for a label.",
          "",
          lane
            ? [
                `ACTIVE LANE ${lane.id}: ${lane.name}.`,
                `Services: ${lane.services.join(", ") || "none listed"}.`,
                `Areas: ${lane.areas.join(", ") || "none listed"}.`,
                lane.skip.length ? `Skip: ${lane.skip.join("; ")}.` : "",
                s.never_list.length ? `Never, in any lane: ${s.never_list.join("; ")}.` : "",
              ]
                .filter(Boolean)
                .join("\n")
            : "NO LANE IS ACTIVE. Don't add any businesses.",
          off.length ? `Faults switched off (never claim these): ${off.map((f) => `${f} (${FAULT_LABEL[f]})`).join(", ")}.` : "",
          process.env.ABR_GUID
            ? "ABNs: Pulse checks them itself when you add a prospect. Give the ABN from their site or ABN Lookup."
            : "ABNs: Pulse can't check them yet. Read the public ABN Lookup site and give abn_status and gst_registered with the ABN; keep a business only if it's active and certainly theirs.",
          "",
          template
            ? [
                `TEMPLATE v${template.version} (pass template_version ${template.version} to outreach_submit). Pulse fills every {placeholder}; you write only the three slots.`,
                `Subject: ${template.first_subject}`,
                "First email:",
                template.first_body,
                "",
                `Follow-up, day 7, same thread (subject: ${template.followup_subject}):`,
                template.followup_body,
                "",
                "SLOT RULES:",
                template.slot_rules,
              ].join("\n")
            : "The template is missing: don't submit anything.",
          "",
          "TOKENS:",
          TOKEN_GUIDE,
          "",
          `LESSONS${l ? ` v${l.version}` : ""}:`,
          l?.body ?? "None yet.",
          "",
          "LIVE TEST:",
          lt ? `${lt.question}\nA: ${lt.version_a}\nB: ${lt.version_b}\nStarted ${lt.started_on ?? "not yet"}; ends after ${lt.ends_after ?? "?"} first emails.` : "None.",
          "",
          `RUN INSTRUCTIONS${r ? ` v${r.version}` : ""}:`,
          r?.body ?? "None.",
        ]
          .filter((x) => x !== "")
          .join("\n"),
      };
    },
  },
  {
    name: "outreach_check_business",
    title: "Check a business",
    description:
      "Allowed or blocked: has this business ever been approached, asked not to be, or is it otherwise off limits? Check every business before reading its site. A block from one of Kyle's private lists gives no reason. Pass everything you know; the more keys, the better the check.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Their website or domain." },
        name: { type: "string", description: "The business name." },
        abn: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        postcode: { type: "string", description: "Their postcode: needed for the client-area check." },
        services: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(a, ctx) {
      const input = { domain: str(a, "domain", 300), name: str(a, "name", 200), abn: str(a, "abn", 20), email: str(a, "email", 200), phone: str(a, "phone", 40), postcode: str(a, "postcode", 4), services: list(a, "services") };
      if (!input.domain && !input.name && !input.email) throw new InputError("Give at least a domain, a name or an email.");
      const v = publicVerdict(await checkBusiness(ctx.sb, input));
      return { text: v.allowed ? "Allowed." : `Blocked${v.reasons.length ? `: ${v.reasons.join("; ")}` : ""}. Move on.` };
    },
  },
  {
    name: "outreach_add_prospect",
    title: "Add a prospect",
    description:
      "Record a business you've read and want to measure, with the address published on its own site. Pulse checks it again (it refuses one that's blocked), checks the ABN when it can, and returns a prospect_id. Then call outreach_measure on its home page and its main service page. Never guess an address or build one from a pattern; never take one from a directory.",
    inputSchema: {
      type: "object",
      properties: {
        business_name: { type: "string" },
        website: { type: "string", description: "Their own website, e.g. https://catten.com.au" },
        suburb: { type: "string" },
        state: { type: "string", enum: [...AU_STATES] },
        postcode: { type: "string", description: "Four digits. Required: it's how Pulse keeps away from Kyle's clients' areas." },
        services: { type: "array", items: { type: "string" }, description: "Their main services, in a few words each." },
        category: { type: "string" },
        phone: { type: "string" },
        abn: { type: "string", description: "Eleven digits." },
        abn_status: { type: "string", enum: ["active", "cancelled", "not_found"], description: "From ABN Lookup, only when Pulse can't check ABNs itself (see the brief)." },
        gst_registered: { type: "boolean" },
        email: { type: "string", description: "The address published on their own site." },
        first_name: { type: "string", description: "Only if a first name is published with that address." },
        address_kind: { type: "string", enum: ["owner", "general"], description: "A named owner's address, or a general inbox." },
        contact_page: { type: "string", description: "The page on their own site where the address is published." },
        context: { type: "string", description: "The text around the address on that page, a sentence or two." },
      },
      required: ["business_name", "website", "suburb", "state", "postcode", "abn", "email", "address_kind", "contact_page"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(a, ctx) {
      const name = need(a, "business_name", 200);
      const website = siteUrl(need(a, "website", 300));
      const domain = normaliseDomain(website ?? "");
      if (!website || !domain) throw new InputError("website must be the business's own site, not a directory or a social page.");
      const suburb = need(a, "suburb", 80);
      const state = need(a, "state", 3).toUpperCase();
      if (!(AU_STATES as readonly string[]).includes(state)) throw new InputError(`state must be one of ${AU_STATES.join(", ")}.`);
      const postcode = need(a, "postcode", 4);
      if (!/^[0-9]{4}$/.test(postcode)) throw new InputError("postcode must be four digits.");
      const email = normaliseEmail(need(a, "email", 200));
      if (!email) throw new InputError("email isn't an email address.");
      const kind = need(a, "address_kind", 10);
      if (kind !== "owner" && kind !== "general") throw new InputError("address_kind must be owner or general.");
      const page = need(a, "contact_page", 500);
      if (!onOwnSite(page, domain)) throw new InputError("contact_page must be on the business's own site.");
      const abn = normaliseAbn(need(a, "abn", 20));
      if (!abn) throw new InputError("That ABN fails the ATO's check digit.");
      const services = list(a, "services");
      const phone = str(a, "phone", 40) ?? null;

      const lane = await activeLane(ctx);
      if (!lane) throw new InputError("No lane is active, so nothing can be added. Stop the run.");
      const today = melbourneDate(new Date());
      const { count: added } = await ctx.sb.from("outreach_prospects").select("id", { count: "exact", head: true }).eq("source", "claude_run").eq("found_on", today);
      if ((added ?? 0) >= MAX_ADDS_A_DAY) throw new InputError(`${MAX_ADDS_A_DAY} prospects have been added today, the most a day allows. Stop the run.`);

      const verdict = await checkBusiness(ctx.sb, { domain, name, abn, email, phone, postcode, services });
      if (!verdict.allowed) {
        const pub = publicVerdict(verdict);
        return { text: `Not added: blocked${pub.reasons.length ? ` (${pub.reasons.join("; ")})` : ""}. Move on.`, isError: true };
      }

      // The ABN: Pulse's own check when it can, Claude's reading when it can't.
      const abr = await lookupAbn(abn, name);
      let abnFields: Record<string, unknown>;
      if (abr.checked) {
        if (abr.record.status !== "active") return { text: `Not added: ABN ${abn} is ${abr.record.status.replace("_", " ")} on the ABR. Move on.`, isError: true };
        if (!abr.nameMatches) {
          return { text: `Not added: ABN ${abn} is registered to ${abr.record.entityName ?? "another name"}, not ${name}. The match isn't certain, so move on.`, isError: true };
        }
        abnFields = { abn_status: "active", abn_name: abr.record.entityName, gst_registered: abr.record.gstRegistered, abn_checked_by: "abr", abn_checked_at: new Date().toISOString() };
      } else {
        const said = str(a, "abn_status", 12);
        if (said !== "active") return { text: `Not added: the ABN has to be active on ABN Lookup (you said ${said ?? "nothing"}). Move on.`, isError: true };
        const gst = a.gst_registered;
        abnFields = { abn_status: "active", gst_registered: typeof gst === "boolean" ? gst : null, abn_checked_by: "claude", abn_checked_at: new Date().toISOString() };
      }

      const s = await settingsOf(ctx);
      const { data: p, error } = await ctx.sb
        .from("outreach_prospects")
        .insert({
          business_name: name,
          domain,
          website_url: website,
          category: str(a, "category", 80) ?? null,
          services,
          phone,
          abn,
          ...abnFields,
          suburb,
          state,
          postcode,
          lane_id: lane.id,
          source: "claude_run",
          status: "found",
          test: s.test_mode,
          created_by: ACTOR,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") return { text: "Not added: that domain is already a prospect. Move on.", isError: true };
        throw new Error(error.message);
      }
      const id = (p as { id: string }).id;
      const firstName = str(a, "first_name", 40);
      const { error: cErr } = await ctx.sb.from("outreach_contacts").insert({
        prospect_id: id,
        email,
        first_name: firstName && /^[A-Za-z][A-Za-z'’-]{0,29}$/.test(firstName) ? firstName : null,
        address_kind: kind,
        source_url: page,
        context: str(a, "context", 600) ?? null,
        seen_on: today,
        mx_provider: await lookupMxProvider(email),
      });
      if (cErr) {
        await ctx.sb.from("outreach_prospects").delete().eq("id", id);
        throw new Error(cErr.message);
      }
      await event(ctx, id, "found", { lane: lane.id, abn_checked_by: abnFields.abn_checked_by });
      return { text: `Added ${name}: prospect_id ${id}${abr.checked ? " (ABN checked by Pulse)" : ""}. Next: outreach_measure on its home page, then its main service page.` };
    },
  },
  {
    name: "outreach_measure",
    title: "Measure a page",
    description:
      "Pulse measures one page of a prospect's own site (Google's phone speed test, ad tracking, HTTPS, the main menu's links, a tappable phone number) and keeps it as the proof. Takes 15 to 40 seconds. Use the measurement_id in outreach_submit's claims. Measure the home page and the main service page; four pages at most per prospect.",
    inputSchema: {
      type: "object",
      properties: { prospect_id: ID, url: { type: "string", description: "A page on the prospect's own site." } },
      required: ["prospect_id", "url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(a, ctx) {
      const p = await prospectOf(ctx, need(a, "prospect_id", 40));
      if (!["found", "measured"].includes(p.status)) throw new InputError(`This prospect is ${p.status}; it can't be measured now.`);
      const url = siteUrl(need(a, "url", 500));
      if (!url || !p.domain || !onOwnSite(url, p.domain)) throw new InputError("url must be a page on the prospect's own site.");
      const { count } = await ctx.sb.from("outreach_measurements").select("id", { count: "exact", head: true }).eq("prospect_id", p.id).eq("purpose", "initial");
      if ((count ?? 0) >= MAX_MEASURES_PER_PROSPECT) throw new InputError(`${MAX_MEASURES_PER_PROSPECT} pages are measured already. Submit or drop it.`);

      const m = await measureSite(url);
      const stored = await storeMeasurement(ctx.sb, p.id, m, "initial");
      if (p.status === "found") await ctx.sb.from("outreach_prospects").update({ status: "measured" }).eq("id", p.id).eq("status", "found");
      await event(ctx, p.id, "measured", { url: m.url, status: m.status, faults: m.faults });

      const { data: runs } = await ctx.sb.from("outreach_measurements").select("status, ad_signal, faults").eq("prospect_id", p.id).eq("status", "ok");
      const ok = (runs as { status: string; ad_signal: boolean | null; faults: Fault[] }[] | null) ?? [];
      const allFaults = [...new Set(ok.flatMap((r) => r.faults ?? []))];
      const ad = ok.some((r) => r.ad_signal);
      const broken = m.menu.filter((l) => l.status !== null && (l.status === 404 || l.status === 410 || l.status >= 500));
      const tags = [m.tags.aw.length ? "Google Ads" : "", m.tags.metaPixel.length ? "Meta Pixel" : "", m.tags.ga4.length ? "GA4" : "", m.tags.ua.length ? "old Universal Analytics" : ""].filter(Boolean);
      const lines = [
        `measurement_id ${stored.id} (${m.url}): ${m.status}${m.error ? ` (${m.error})` : ""}.`,
        m.status === "ok"
          ? [
              `Faults on this page: ${m.faults.length ? m.faults.map((f) => `${f} (${FAULT_LABEL[f]})`).join(", ") : "none"}.`,
              `Ad signal on this page: ${m.adSignal ? "yes" : "no"}${tags.length ? ` (tags: ${tags.join(", ")})` : ""}.`,
              m.psi.fcpMs !== null ? `First paint ${secondsWords(m.psi.fcpMs)}, largest paint ${m.psi.lcpMs !== null ? secondsWords(m.psi.lcpMs) : "not measured"} (write [[first_paint]] or [[largest_paint]], never the figure).` : "No speed test result.",
              broken.length ? `Broken menu pages: ${broken.map((l) => `${l.label || l.url} (${l.status})`).join(", ")} (use [[broken_page]] and pass broken_page_name).` : "",
              `[[page]] may name this page as: ${[...pageNamesFor(m.url, m.menu.map((l) => l.label))].slice(0, 8).join(", ")}.`,
            ]
              .filter(Boolean)
              .join("\n")
          : "Nothing on this page can be claimed. A page Pulse couldn't read is never a broken page.",
        `So far for this business: ad signal ${ad ? "yes" : "no"}; faults ${allFaults.length ? allFaults.join(", ") : "none"}. ${qualifies(ad, allFaults) ? "It qualifies: write the slots and submit." : "It doesn't qualify yet (it needs the ad signal and two faults). Measure the main service page, or drop it."}`,
      ];
      return { text: lines.join("\n") };
    },
  },
  {
    name: "outreach_submit",
    title: "Submit the draft",
    description:
      "Submit the three slots for a prospect. Pulse checks the business again, fetches the contact page again, checks every claim against its measurements, checks the wording, fills the tokens and renders both emails from Kyle's template. Refused: you get the reasons; fix it once, and if it's refused again, drop it. Accepted: it waits for Pulse's own second measurement an hour on, then queues. You never send anything.",
    inputSchema: {
      type: "object",
      properties: {
        prospect_id: ID,
        template_version: { type: "integer" },
        page_name: { type: "string", description: "The page the first email is about, as outreach_measure allowed it." },
        area: { type: "string", description: "Their own suburb, or a region their postcode is in, for [[area]]." },
        broken_page_name: { type: "string", description: "For a broken-page claim: the menu label of the broken page." },
        slots: { type: "object", properties: SUBMIT_SLOTS, required: [...SLOTS], additionalProperties: false },
        claims: {
          type: "array",
          description: "One per email: the first email's fault in finding or why_and_fix, the follow-up's in second_finding.",
          items: {
            type: "object",
            properties: { fault: { type: "string", enum: [...FAULTS] }, measurement_id: { type: "string" }, slot: { type: "string", enum: [...SLOTS] } },
            required: ["fault", "measurement_id", "slot"],
            additionalProperties: false,
          },
        },
        personal_count: { type: "integer", description: "How many sentences are true only of this business." },
      },
      required: ["prospect_id", "template_version", "page_name", "slots", "claims", "personal_count"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(a, ctx) {
      const prospectId = need(a, "prospect_id", 40);
      await prospectOf(ctx, prospectId);
      const slotsIn = a.slots;
      if (!slotsIn || typeof slotsIn !== "object" || Array.isArray(slotsIn)) throw new InputError("slots must be an object with finding, why_and_fix and second_finding.");
      const slots = {} as Record<SlotName, string>;
      for (const k of SLOTS) {
        const v = (slotsIn as Record<string, unknown>)[k];
        if (typeof v !== "string" || !v.trim()) throw new InputError(`slots.${k} is required.`);
        slots[k] = v.trim().slice(0, 1200);
      }
      const claimsIn = a.claims;
      if (!Array.isArray(claimsIn) || claimsIn.length === 0 || claimsIn.length > 6) throw new InputError("claims must list one claim per email.");
      const claims = claimsIn.map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        if (!(FAULTS as readonly string[]).includes(String(o.fault))) throw new InputError("Each claim's fault must be one of the six.");
        if (!(SLOTS as readonly string[]).includes(String(o.slot))) throw new InputError("Each claim's slot must be finding, why_and_fix or second_finding.");
        if (typeof o.measurement_id !== "string") throw new InputError("Each claim needs its measurement_id.");
        return { fault: o.fault as Fault, measurement_id: o.measurement_id, slot: o.slot as SlotName };
      });
      const tv = int(a, "template_version");
      const pc = int(a, "personal_count");
      if (tv === undefined || pc === undefined) throw new InputError("template_version and personal_count are whole numbers.");
      const r = await submitDraft(
        ctx.sb,
        {
          prospect_id: prospectId,
          page_name: need(a, "page_name", 80),
          area: str(a, "area", 80) ?? null,
          broken_page_name: str(a, "broken_page_name", 80) ?? null,
          slots,
          claims,
          personal_count: pc,
          template_version: tv,
        },
        ACTOR,
      );
      if (!r.ok) return { text: `Refused:\n- ${r.reasons.join("\n- ")}`, isError: true };
      return { text: "Accepted. Pulse measures each claimed fault again an hour or more after its first run; if both repeat, the pair queues for the next sending day. Nothing more to do for this one." };
    },
  },
  {
    name: "outreach_drop",
    title: "Drop a prospect",
    description: "Drop a prospect you've added but won't submit (no ad signal, fewer than two faults, refused twice, anything else), with the reason in a few words.",
    inputSchema: { type: "object", properties: { prospect_id: ID, reason: { type: "string" } }, required: ["prospect_id", "reason"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(a, ctx) {
      const p = await prospectOf(ctx, need(a, "prospect_id", 40));
      const reason = need(a, "reason", 200);
      if (!["found", "measured"].includes(p.status)) throw new InputError(`This prospect is ${p.status} and can't be dropped from here.`);
      await ctx.sb.from("outreach_messages").update({ status: "dropped", drop_reason: reason }).eq("prospect_id", p.id).eq("status", "awaiting_confirmation");
      await ctx.sb.from("outreach_prospects").update({ status: "dropped", drop_reason: reason }).eq("id", p.id).in("status", ["found", "measured"]);
      await event(ctx, p.id, "dropped", { reason });
      return { text: `Dropped ${p.business_name ?? "it"}: ${reason}.` };
    },
  },
  {
    name: "outreach_replies_to_label",
    title: "Replies to label",
    description: "Replies that wait for a label, with their words and what our email was about. Opt-outs, bounces and automatic replies are already handled; these are the rest.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(_a, ctx) {
      const { data } = await ctx.sb.from("outreach_replies").select("id, prospect_id, message_id, quote, received_at").eq("kind", "reply").is("label", null).order("received_at").limit(30);
      const rows = (data as { id: string; prospect_id: string; message_id: string | null; quote: string | null; received_at: string }[] | null) ?? [];
      if (!rows.length) return { text: "No replies wait for a label." };
      const [{ data: ps }, { data: ms }] = await Promise.all([
        ctx.sb.from("outreach_prospects").select("id, business_name").in("id", rows.map((r) => r.prospect_id)),
        ctx.sb.from("outreach_messages").select("id, fault, test_mode").in("id", rows.map((r) => r.message_id).filter((x): x is string => !!x)),
      ]);
      const names = new Map(((ps as { id: string; business_name: string | null }[] | null) ?? []).map((p) => [p.id, p.business_name]));
      const msgs = new Map(((ms as { id: string; fault: Fault | null; test_mode: boolean | null }[] | null) ?? []).map((m) => [m.id, m]));
      return {
        text: rows
          .map((r) => {
            const m = r.message_id ? msgs.get(r.message_id) : undefined;
            return `reply_id ${r.id}${m?.test_mode ? " [test]" : ""}: ${names.get(r.prospect_id) ?? "A business"}, ${r.received_at.slice(0, 10)}. Our email was about: ${m?.fault ? FAULT_LABEL[m.fault].toLowerCase() : "unknown"}.\n"${(r.quote ?? "").slice(0, 800)}"`;
          })
          .join("\n\n"),
      };
    },
  },
  {
    name: "outreach_label_reply",
    title: "Label a reply",
    description:
      "Label one reply: interested or question (Pulse makes a lead for Kyle, due today), later (with later_date: a card comes back that day), sorted, no_thanks, wrong_fact, complaint (Pulse pauses everything) or other. Label only what's plain from their words; when unsure, leave it for Kyle. Nothing is ever sent to them.",
    inputSchema: {
      type: "object",
      properties: {
        reply_id: { type: "string", description: "From outreach_replies_to_label." },
        label: { type: "string", enum: Object.keys(LABEL_TEXT) },
        later_date: { type: "string", description: "For later: when to bring it back, YYYY-MM-DD, after today." },
      },
      required: ["reply_id", "label"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a, ctx) {
      const id = need(a, "reply_id", 40);
      const label = need(a, "label", 20);
      if (!isReplyLabel(label)) throw new InputError(`label must be one of ${Object.keys(LABEL_TEXT).join(", ")}.`);
      const later = str(a, "later_date", 10) ?? null;
      if (later && !DATE_RE.test(later)) throw new InputError("later_date is YYYY-MM-DD.");
      const r = await applyLabel(ctx.sb, id, label, later, "claude", ACTOR);
      if (!r.ok) return { text: r.message, isError: true };
      return { text: `Labelled ${LABEL_TEXT[label].toLowerCase()}.${r.leadId ? " It's in Kyle's pipeline, due today." : ""}` };
    },
  },
  {
    name: "outreach_numbers",
    title: "Numbers",
    description: "Counts between two dates (Melbourne): found, measured, dropped by reason, refused, submitted, sent, follow-ups, bounced, replied, opted out, each label and leads, by lane and by fault. Test sends are counted apart. Under 30 sends, no rates.",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD, inclusive" } },
      required: ["from", "to"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(a, ctx) {
      const from = need(a, "from", 10);
      const to = need(a, "to", 10);
      if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) throw new InputError("from and to are YYYY-MM-DD, in order.");
      const start = melbourneInstant(from, "00:00").toISOString();
      const end = melbourneInstant(addDays(to, 1), "00:00").toISOString();
      const { data: evs } = await ctx.sb.from("outreach_events").select("prospect_id, message_id, kind, detail").gte("at", start).lt("at", end).limit(5000);
      const events = (evs as { prospect_id: string | null; message_id: string | null; kind: string; detail: Record<string, unknown> | null }[] | null) ?? [];
      const pids = [...new Set(events.map((e) => e.prospect_id).filter((x): x is string => !!x))];
      const { data: ps } = pids.length ? await ctx.sb.from("outreach_prospects").select("id, lane_id, test").in("id", pids) : { data: [] };
      const pmap = new Map(((ps as { id: string; lane_id: number | null; test: boolean }[] | null) ?? []).map((p) => [p.id, p]));
      const mids = [...new Set(events.map((e) => e.message_id).filter((x): x is string => !!x))];
      const { data: ms } = mids.length ? await ctx.sb.from("outreach_messages").select("id, fault").in("id", mids) : { data: [] };
      const fmap = new Map(((ms as { id: string; fault: Fault | null }[] | null) ?? []).map((m) => [m.id, m.fault]));
      const groups = new Map<string, Record<string, number>>();
      const bump = (g: string, k: string) => {
        const row = groups.get(g) ?? {};
        row[k] = (row[k] ?? 0) + 1;
        groups.set(g, row);
      };
      const drops: Record<string, number> = {};
      for (const e of events) {
        const p = e.prospect_id ? pmap.get(e.prospect_id) : undefined;
        const testRun = !!p?.test || e.detail?.test === true;
        const key = e.kind === "labelled" ? `labelled ${String(e.detail?.label ?? "?")}` : e.kind;
        bump(testRun ? "Test" : "All", key);
        if (!testRun) {
          if (p?.lane_id) bump(`Lane ${p.lane_id}`, key);
          const f = e.message_id ? fmap.get(e.message_id) : null;
          if (f && ["sent", "followed_up", "bounced", "replied", "opted_out", "labelled"].includes(e.kind)) bump(`Fault ${f}`, key);
          if (e.kind === "dropped") {
            const why = String(e.detail?.reason ?? "unknown").slice(0, 60);
            drops[why] = (drops[why] ?? 0) + 1;
          }
        }
      }
      if (!groups.size) return { text: `Nothing happened between ${from} and ${to}.` };
      const order = ["found", "measured", "dropped", "refused", "submitted", "confirmed", "queued", "sent", "followed_up", "bounced", "replied", "opted_out", "lead_created"];
      const fmt = (row: Record<string, number>) => {
        const keys = [...order.filter((k) => row[k]), ...Object.keys(row).filter((k) => !order.includes(k)).sort()];
        const sent = row.sent ?? 0;
        const rate = (k: string) => (sent >= 30 && row[k] ? ` (${Math.round((100 * row[k]) / sent)}%)` : "");
        return keys.map((k) => `${k} ${row[k]}${["replied", "bounced", "opted_out"].includes(k) ? rate(k) : ""}`).join(", ");
      };
      const lines = [...groups.entries()].sort(([a1], [b1]) => (a1 === "All" ? -1 : b1 === "All" ? 1 : a1.localeCompare(b1))).map(([g, row]) => `${g}: ${fmt(row)}`);
      const dropLines = Object.entries(drops).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([w, n]) => `  ${n} × ${w}`);
      return { text: [`${from} to ${to}:`, ...lines, ...(dropLines.length ? ["Dropped, by reason:", ...dropLines] : [])].join("\n") };
    },
  },

  // ---------- the advisor's three writes ----------
  {
    name: "outreach_set_lessons",
    title: "Write the lessons",
    description: "Replace the lessons text the morning run reads, as a new version (the old one is kept). Only after Kyle has said yes to the change in this chat.",
    inputSchema: { type: "object", properties: { body: { type: "string" }, why: { type: "string", description: "What changed and why, for the change log." } }, required: ["body", "why"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    advisorOnly: true,
    async run(a, ctx) {
      return newVersion(ctx, "outreach_lessons", "Lessons", need(a, "body", 8000), need(a, "why", 300));
    },
  },
  {
    name: "outreach_set_run_instructions",
    title: "Write the run instructions",
    description: "Replace the morning run's instructions, as a new version (the old one is kept). Only after Kyle has said yes to the change in this chat. They can't loosen what Pulse enforces in code.",
    inputSchema: { type: "object", properties: { body: { type: "string" }, why: { type: "string" } }, required: ["body", "why"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    advisorOnly: true,
    async run(a, ctx) {
      return newVersion(ctx, "outreach_run_instructions", "Run instructions", need(a, "body", 8000), need(a, "why", 300));
    },
  },
  {
    name: "outreach_set_test",
    title: "Plan, start or end a test",
    description:
      "The test register holds one live test at a time. Plan or start one (question, version_a, version_b, ends_after first emails, start true to make it live now), or end the live one with its result. Only after Kyle has said yes in this chat.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["plan", "start", "end"] },
        test_id: { type: "string", description: "For start (a planned test) or end." },
        question: { type: "string" },
        version_a: { type: "string" },
        version_b: { type: "string" },
        ends_after: { type: "integer" },
        result: { type: "string", description: "For end: what it showed." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    advisorOnly: true,
    async run(a, ctx) {
      const action = need(a, "action", 10);
      const today = melbourneDate(new Date());
      const { data: live } = await ctx.sb.from("outreach_tests").select("id, question").eq("status", "live").maybeSingle();
      if (action === "plan") {
        const ends = int(a, "ends_after");
        const { data, error } = await ctx.sb
          .from("outreach_tests")
          .insert({ question: need(a, "question", 300), version_a: need(a, "version_a", 1000), version_b: need(a, "version_b", 1000), ends_after: ends && ends > 0 ? ends : null, status: "planned", created_by: ACTOR })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        await log(ctx, "Planned a test", str(a, "question", 300) ?? null);
        return { text: `Planned: test_id ${(data as { id: string }).id}. Start it with action start when Kyle says so.` };
      }
      if (action === "start") {
        if (live) throw new InputError(`One live test at a time: "${(live as { question: string }).question}" is running. End it first.`);
        const id = need(a, "test_id", 40);
        const { data, error } = await ctx.sb.from("outreach_tests").update({ status: "live", started_on: today, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "planned").select("question");
        if (error) throw new Error(error.message);
        if (!data?.length) throw new InputError("No planned test with that id.");
        await log(ctx, "Started a test", (data[0] as { question: string }).question);
        return { text: "Started. The morning run sees it in the brief." };
      }
      if (action === "end") {
        const id = need(a, "test_id", 40);
        const result = need(a, "result", 2000);
        const { data, error } = await ctx.sb.from("outreach_tests").update({ status: "ended", result, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "live").select("question");
        if (error) throw new Error(error.message);
        if (!data?.length) throw new InputError("No live test with that id.");
        await log(ctx, "Ended a test", result.slice(0, 300));
        return { text: "Ended, with its result on record." };
      }
      throw new InputError("action is plan, start or end.");
    },
  },
];

async function log(ctx: DraperContext, what: string, why: string | null) {
  await ctx.sb.from("outreach_change_log").insert({ what, why, changed_by: "claude (advisor)" });
}

async function newVersion(ctx: DraperContext, table: "outreach_lessons" | "outreach_run_instructions", label: string, body: string, why: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await ctx.sb.from(table).select("version").order("version", { ascending: false }).limit(1).maybeSingle();
    const next = ((data as { version: number } | null)?.version ?? 0) + 1;
    const { error } = await ctx.sb.from(table).insert({ version: next, body, note: why, created_by: "claude (advisor)" });
    if (!error) {
      await log(ctx, `${label} v${next}`, why);
      return { text: `${label} saved as version ${next}. The old version is kept.` };
    }
    if (error.code !== "23505") throw new Error(error.message);
  }
  return { text: "Someone saved at the same moment. Try again.", isError: true };
}

export function toolsFor(advisor: boolean): Tool[] {
  return DRAPER_TOOLS.filter((t) => advisor || !t.advisorOnly);
}

export async function callDraperTool(name: string, args: Args, ctx: DraperContext): Promise<{ text: string; isError?: boolean } | null> {
  const tool = toolsFor(ctx.advisor).find((t) => t.name === name);
  if (!tool) return null;
  try {
    return await tool.run(args ?? {}, ctx);
  } catch (e) {
    if (e instanceof InputError) return { text: e.message, isError: true };
    console.error("[mcp outreach] tool failed:", name, e);
    return { text: "That didn't work on Pulse's side. Try again in a moment, or move on.", isError: true };
  }
}

export const DRAPER_INSTRUCTIONS = `This is Draper, Hartwell Digital's outreach desk in Hartwell Pulse. You find small businesses that advertise and have a measurable fault on their site, and hand Pulse what it needs to write to them. You never send anything: Pulse sends from Kyle's mailbox, on its own clock, after checking everything again itself.

Start every run with outreach_brief and follow its run instructions. Work only in the active lane and stop at the target. Check every business with outreach_check_business before reading its site. Never guess an email address, build one from a pattern, or take one from a directory. Never write a number, a weekday, a month, a page name or a place in a slot: use the tokens. Write in Australian English.`;

export const ADVISOR_INSTRUCTIONS = `${DRAPER_INSTRUCTIONS}

This is the advisor connector. It can also write the lessons, the run instructions and the test register, but only ever after Kyle has said yes to that exact change in this chat.`;
