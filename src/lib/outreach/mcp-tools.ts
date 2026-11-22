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
import { normaliseAbn, normaliseDomain, normaliseEmail, undeliverableAddress } from "./normalise.ts";
import { FAULT_GUIDE, pageNamesFor, secondsWords, TOKEN_GUIDE } from "./tokens.ts";
import { SLOTS, type SlotName } from "./lint.ts";
import { firstEmailCap, firstEmailsToday, MAX_FIRST_EMAILS_A_DAY } from "./limits.ts";
import { addDays, calendar, melbourneDate, melbourneInstant, nextSendingDay } from "./schedule.ts";
import { applyLabel } from "./replies.ts";
import { LABEL_TEXT, isReplyLabel } from "./replies-rules.ts";
import { AU_STATES, FAULT_LABEL, FAULT_RANK, FAULTS, type Fault } from "./rules.ts";
import { adsEvidenceFor } from "./ads.ts";
import { ADS_MAX_AGE_HOURS, libraryUrls, liveAds, platformWords, readAdsCheck } from "./ads-rules.ts";
import { isAdsTemplate } from "./render.ts";
import { TEMPLATE_ADS } from "./template-ads.ts";
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

/** Whether the active lane writes with the ads template (Draper plan 2). */
async function adsTemplateActive(ctx: DraperContext): Promise<boolean> {
  const lane = await activeLane(ctx);
  if (!lane) return false;
  const { data } = await ctx.sb.from("outreach_templates").select("first_subject, first_body").eq("version", lane.template_version).maybeSingle();
  return !!data && isAdsTemplate(data as { first_subject: string; first_body: string });
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
  else if (!day) why = "There's no sending day in the next two months: the pause dates cover it";
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
      const template = tpl as { version: number; first_subject: string; first_body: string; followup_subject: string; followup_body: string; slot_rules: string; example: string | null } | null;
      const adsT = !!template && isAdsTemplate(template);
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
          "Finish every run, even one that found nothing, with outreach_finish_run: sites read, skipped by reason, added, measured, submitted, dropped by reason.",
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
                ...(adsT && template.example ? ["", "EXAMPLE (made up, tokens filled):", template.example] : []),
              ].join("\n")
            : "The template is missing: don't submit anything.",
          adsT
            ? [
                "",
                "ADS CHECK (this template): a business only gets an email when Meta's Ad Library or Google's Ads Transparency Centre shows its ads live, pointing to its own website. A tag on the site isn't proof: tags outlive the ads by years.",
                "The libraries only open in a browser. A run without one (the 5:30am cloud run) finds, checks, adds and measures businesses, then leaves them waiting: it never submits. The browser step calls outreach_ads_queue, records both libraries for each business with outreach_record_ads, then writes and submits the ones with live ads, best first, until the target is met.",
                'Drop with a reason: "no live ads" when neither library shows them; "no faults" when neither measured page has one; "not registered for GST" when ABN Lookup shows no GST registration (the size floor).',
                "The first email is about the best-ranked fault on record. Ranked best first: " + FAULT_RANK.join(", ") + ".",
              ].join("\n")
            : "",
          "",
          "TOKENS:",
          TOKEN_GUIDE,
          "",
          "FAULTS:",
          FAULT_GUIDE,
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
        gst_registered: { type: "boolean", description: "From ABN Lookup's Goods & Services Tax line. Required when Pulse can't check ABNs itself; a business not registered for GST isn't added (the size floor)." },
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
      const live = await settingsOf(ctx);
      if (!live.test_mode && undeliverableAddress(email)) throw new InputError("That address can't receive mail. Move on.");
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
        if (typeof gst !== "boolean") return { text: 'Not added: give gst_registered from ABN Lookup ("Goods & Services Tax (GST)": registered from a date, or not currently registered).', isError: true };
        abnFields = { abn_status: "active", gst_registered: gst, abn_checked_by: "claude", abn_checked_at: new Date().toISOString() };
      }
      // The size floor (Kyle, 22 November 2026): GST registration means a
      // turnover of $75,000 or more, a business with ad money worth helping.
      if (abnFields.gst_registered === false) return { text: "Not added: the ABN isn't registered for GST, under the size floor. Move on.", isError: true };

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
              `Layout shift ${m.psi.cls ?? "not measured"} (poor from 0.25), blocking time ${m.psi.tbtMs !== null ? `${m.psi.tbtMs} ms` : "not measured"} (poor from 600 ms), phone layout ${m.mobileViewport === null ? "couldn't tell" : m.mobileViewport ? "yes" : "no"}. For choosing only: never put these figures in a slot.`,
              broken.length ? `Broken menu pages: ${broken.map((l) => `${l.label || l.url} (${l.status})`).join(", ")} (use [[broken_page]] and pass broken_page_name).` : "",
              `[[page]] may name this page as: ${[...pageNamesFor(m.url, m.menu.map((l) => l.label))].slice(0, 8).join(", ")}.`,
            ]
              .filter(Boolean)
              .join("\n")
          : "Nothing on this page can be claimed. A page Pulse couldn't read is never a broken page.",
        (await adsTemplateActive(ctx))
          ? `So far for this business: faults ${allFaults.length ? FAULT_RANK.filter((f) => allFaults.includes(f)).join(", ") : "none"} (best first: the first email is about the first one); tags on the site ${ad ? "yes" : "none seen"}. ${allFaults.length ? "It has a fault to write about. It still needs its ads check in the browser (outreach_ads_queue) before any draft: don't submit it from a run without a browser." : "No faults yet: measure its main service page, or drop it (\"no faults\")."}`
          : `So far for this business: ad signal ${ad ? "yes" : "no"}; faults ${allFaults.length ? allFaults.join(", ") : "none"}. ${qualifies(ad, allFaults) ? "It qualifies: write the slots and submit." : "It doesn't qualify yet (it needs the ad signal and two faults). Measure the main service page, or drop it."}`,
      ];
      return { text: lines.join("\n") };
    },
  },
  {
    name: "outreach_submit",
    title: "Submit the draft",
    description:
      "Submit the slots for a prospect. Pulse checks the business again, fetches the contact page again, checks every claim against its measurements (and, for the ads template, against the ad-library checks you recorded), checks the wording, fills the tokens and renders the emails from Kyle's template. In the ads template second_finding may be empty: then there's no follow-up. Refused: you get the reasons; fix it once, and if it's refused again, drop it. Accepted: it waits for Pulse's own second measurement an hour on, then queues. You never send anything.",
    inputSchema: {
      type: "object",
      properties: {
        prospect_id: ID,
        template_version: { type: "integer" },
        page_name: { type: "string", description: "The page the first email is about, as outreach_measure allowed it." },
        area: { type: "string", description: "Their own suburb, or a region their postcode is in, for [[area]]." },
        broken_page_name: { type: "string", description: "For a broken-page claim: the menu label of the broken page." },
        slots: { type: "object", properties: SUBMIT_SLOTS, required: ["finding", "why_and_fix"], additionalProperties: false },
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
        if (k === "second_finding" && (v === undefined || v === null || (typeof v === "string" && !v.trim()))) {
          slots[k] = "";
          continue;
        }
        if (typeof v !== "string" || !v.trim()) throw new InputError(`slots.${k} is required.`);
        slots[k] = v.trim().slice(0, 1200);
      }
      const claimsIn = a.claims;
      if (!Array.isArray(claimsIn) || claimsIn.length === 0 || claimsIn.length > 6) throw new InputError("claims must list one claim per email.");
      const claims = claimsIn.map((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        if (!(FAULTS as readonly string[]).includes(String(o.fault))) throw new InputError(`Each claim's fault must be one of: ${FAULTS.join(", ")}.`);
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
      return {
        text: `Accepted${r.messageIds.followUp ? "" : " (no follow-up)"}. Pulse measures each claimed fault again an hour or more after its first run; if ${r.messageIds.followUp ? "both repeat, the pair queues" : "it repeats, the email queues"} for the next sending day. Nothing more to do for this one.`,
      };
    },
  },
  {
    name: "outreach_drop",
    title: "Drop a prospect",
    description: "Drop a prospect you've added but won't submit (no live ads, no faults, not registered for GST, refused twice, anything else), with the reason in a few words.",
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

  {
    name: "outreach_finish_run",
    title: "Finish the run",
    description:
      "Call this once, last thing, every run, even one that found nothing: how many sites you read, what you skipped before adding anything and why, and what you added, measured, submitted and dropped. It's how Kyle sees what each morning cost against what it produced. Reasons are a few words each, e.g. \"no email\", \"outside area\", \"ABN not certain\", \"directory only\", \"wouldn't load\", \"no ad signal\", \"one fault\".",
    inputSchema: {
      type: "object",
      properties: {
        sites_read: { type: "integer", description: "Business sites you opened and read this run." },
        added: { type: "integer" },
        measured: { type: "integer", description: "Prospects measured (not pages)." },
        submitted: { type: "integer" },
        dropped: { type: "integer" },
        skipped: { type: "object", description: "Sites skipped before adding, by reason: {\"no email\": 3, \"outside area\": 2}.", additionalProperties: { type: "integer" } },
        dropped_reasons: { type: "object", description: "Prospects dropped after measuring, by reason.", additionalProperties: { type: "integer" } },
        summary: { type: "string", description: "Your two-line summary." },
      },
      required: ["sites_read", "added", "measured", "submitted", "dropped"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a, ctx) {
      const count = (k: string) => {
        const v = int(a, k);
        if (v === undefined || v < 0 || v > 1000) throw new InputError(`${k} must be a whole number from 0 to 1000.`);
        return v;
      };
      const tally = (k: string) => {
        const v = a[k];
        if (v === undefined || v === null) return {};
        if (typeof v !== "object" || Array.isArray(v)) throw new InputError(`${k} must be an object of reason: count.`);
        const out: Record<string, number> = {};
        for (const [reason, n] of Object.entries(v as Record<string, unknown>).slice(0, 15)) {
          if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new InputError(`${k}["${reason}"] must be a whole number.`);
          const r = reason.trim().toLowerCase().slice(0, 40);
          if (r) out[r] = (out[r] ?? 0) + n;
        }
        return out;
      };
      const s = await settingsOf(ctx);
      const row = {
        sites_read: count("sites_read"),
        added: count("added"),
        measured: count("measured"),
        submitted: count("submitted"),
        dropped: count("dropped"),
        skipped: tally("skipped"),
        dropped_reasons: tally("dropped_reasons"),
        summary: str(a, "summary", 600) ?? null,
        test: s.test_mode,
        created_by: ACTOR,
      };
      const { error } = await ctx.sb.from("outreach_runs").insert(row);
      if (error) {
        if (/outreach_runs/.test(error.message)) return { text: "The run report couldn't be kept yet (Kyle has a migration to run). Carry on with your summary.", isError: true };
        throw new Error(error.message);
      }
      return { text: "Run report kept. Thanks." };
    },
  },

  // ---------- the ads check (Draper plan 2, 22 November 2026) ----------
  {
    name: "outreach_ads_queue",
    title: "Waiting for the ads check",
    description:
      "The businesses added and measured in the last three days that still need their ad-library check, best first: each with the two library searches to open (built by Pulse: Australia, active ads, their own domain), the faults on record best-ranked first, and any checks already recorded. A business that has waited more than three days is dropped here. Use it in the browser step, and in the morning run to count what's waiting.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(_a, ctx) {
      const s = await settingsOf(ctx);
      const today = melbourneDate(new Date());
      const since = addDays(today, -3);
      // Waited too long: the cloud run added it, nobody checked its ads.
      const { data: stale } = await ctx.sb
        .from("outreach_prospects")
        .select("id")
        .eq("source", "claude_run")
        .in("status", ["found", "measured"])
        .lt("found_on", since)
        .limit(200);
      let expired = 0;
      for (const p of (stale as { id: string }[] | null) ?? []) {
        const { count } = await ctx.sb.from("outreach_messages").select("id", { count: "exact", head: true }).eq("prospect_id", p.id);
        if (count) continue;
        const reason = "The ads check didn't happen within three days";
        await ctx.sb.from("outreach_prospects").update({ status: "dropped", drop_reason: reason }).eq("id", p.id).in("status", ["found", "measured"]);
        await event(ctx, p.id, "dropped", { reason });
        expired++;
      }

      const { data: ps } = await ctx.sb
        .from("outreach_prospects")
        .select("id, business_name, domain, suburb, found_on, gst_registered")
        .eq("source", "claude_run")
        .eq("test", s.test_mode)
        .in("status", ["found", "measured"])
        .gte("found_on", since)
        .order("found_on")
        .limit(60);
      const rows = (ps as { id: string; business_name: string | null; domain: string | null; suburb: string | null; found_on: string; gst_registered: boolean | null }[] | null) ?? [];
      const out: { rank: number; text: string }[] = [];
      for (const p of rows) {
        if (!p.domain) continue;
        const [{ count: msgs }, { data: runs }, evidence] = await Promise.all([
          ctx.sb.from("outreach_messages").select("id", { count: "exact", head: true }).eq("prospect_id", p.id),
          ctx.sb.from("outreach_measurements").select("id, url, faults, ad_signal, tags").eq("prospect_id", p.id).eq("status", "ok"),
          adsEvidenceFor(ctx.sb, p.id).catch(() => []),
        ]);
        if (msgs) continue;
        const ok = (runs as { id: string; url: string; faults: Fault[]; ad_signal: boolean | null; tags: Record<string, string[]> | null }[] | null) ?? [];
        const faults = FAULT_RANK.filter((f) => ok.some((r) => r.faults.includes(f)));
        const tags = [...new Set(ok.flatMap((r) => [r.tags?.aw?.length ? "Google Ads tag" : "", r.tags?.meta_pixel?.length ? "Meta Pixel" : ""]).filter(Boolean))];
        const urls = libraryUrls(p.domain);
        const checked = (["meta", "google"] as const).map((pl) => {
          const latest = evidence.filter((e) => e.platform === pl).sort((a, b) => b.checked_at.localeCompare(a.checked_at))[0];
          return latest ? `${pl} ${latest.live ? "LIVE" : "not live"} (${latest.note})` : `${pl} not checked`;
        });
        const live = liveAds(evidence, new Date(), ADS_MAX_AGE_HOURS.submit);
        const best = faults[0];
        out.push({
          rank: (live.platforms.length ? 0 : 100) + (best ? FAULT_RANK.indexOf(best) * 10 : 90) + (tags.length ? 0 : 5),
          text: [
            `${p.business_name ?? "A business"} (prospect_id ${p.id}, ${p.domain}, ${p.suburb ?? "?"}, found ${p.found_on})${p.gst_registered === false ? ": NOT registered for GST, drop it" : p.gst_registered === null ? ": GST unknown, check ABN Lookup before writing" : ""}`,
            `  faults, best first: ${faults.length ? faults.map((f) => `${f} (${FAULT_LABEL[f]})`).join(", ") : "none: drop it (\"no faults\")"}`,
            `  measured pages: ${ok.map((r) => `${r.url} (measurement_id ${r.id}${r.faults.length ? `: ${r.faults.join(", ")}` : ""})`).join("; ") || "none"}`,
            `  tags seen on the site: ${tags.join(", ") || "none (Shopify and Tag Manager sites often hide them; check the libraries anyway)"}`,
            `  meta search: ${urls.meta}`,
            `  google search: ${urls.google}`,
            `  checks: ${checked.join("; ")}${live.platforms.length ? `. Live: ${platformWords(live.platforms)}` : ""}`,
          ].join("\n"),
        });
      }
      const t = await target(ctx, s);
      out.sort((a, b) => a.rank - b.rank);
      return {
        text: [
          `${out.length} business${out.length === 1 ? "" : "es"} waiting for the ads check.${expired ? ` Dropped ${expired} that waited more than three days.` : ""} The next sending day still needs ${t.target} (${t.waiting} already waiting${t.why ? `; ${t.why}` : ""}).`,
          ...out.map((o) => o.text),
        ].join("\n\n"),
      };
    },
  },
  {
    name: "outreach_record_ads",
    title: "Record an ad-library check",
    description:
      "Hand Pulse what a business's ad library showed, as the page's own visible text (document.body.innerText). Pulse reads it itself: which ads are active, when they started or were last shown, and whether they point at the business's own domain. Your reading is never stored as the fact. Meta: open the meta search from outreach_ads_queue, let the results load, pass its text. Google: open the google search, pass its text; when it lists ads, open the ads (up to three) to find the latest Last shown, and pass that ad's address as ad_url and its text as ad_text. Record both libraries for every business, also when nothing is found. Never click an ad: the business pays for that click.",
    inputSchema: {
      type: "object",
      properties: {
        prospect_id: ID,
        platform: { type: "string", enum: ["meta", "google"] },
        library_url: { type: "string", description: "The search you read: the meta or google search address from outreach_ads_queue." },
        page_text: { type: "string", description: "The search page's visible text, once its results have loaded." },
        ad_url: { type: "string", description: "Google only: the ad page you opened (adstransparency.google.com/advertiser/AR…/creative/CR…?region=AU)." },
        ad_text: { type: "string", description: "Google only: that ad page's visible text, with its Last shown date." },
      },
      required: ["prospect_id", "platform", "library_url", "page_text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(a, ctx) {
      const p = await prospectOf(ctx, need(a, "prospect_id", 40));
      if (!["found", "measured"].includes(p.status)) throw new InputError(`This prospect is ${p.status}; its ads can't be checked now.`);
      if (!p.domain) throw new InputError("This prospect has no website on file.");
      const platform = need(a, "platform", 10);
      if (platform !== "meta" && platform !== "google") throw new InputError("platform is meta or google.");
      const { count: before } = await ctx.sb.from("outreach_events").select("id", { count: "exact", head: true }).eq("prospect_id", p.id).eq("kind", "checked");
      if ((before ?? 0) >= 8) throw new InputError("Eight checks are on record for this business already. Submit it or drop it.");
      const now = new Date();
      const pageText = need(a, "page_text", 20_000);
      const adText = str(a, "ad_text", 6000) ?? null;
      const read = readAdsCheck(
        { platform, library_url: need(a, "library_url", 600), page_text: pageText, ad_url: str(a, "ad_url", 400) ?? null, ad_text: adText },
        p.domain,
        now,
        melbourneDate(now),
      );
      if ("problems" in read) throw new InputError(read.problems.join(" "));
      await event(ctx, p.id, "checked", { ads: read.evidence, page_text: pageText.slice(0, 4000), ad_text: adText?.slice(0, 1500) ?? null });
      const all = await adsEvidenceFor(ctx.sb, p.id);
      const live = liveAds(all, now, ADS_MAX_AGE_HOURS.submit);
      const done = new Set(all.filter((e) => now.getTime() - Date.parse(e.checked_at) <= ADS_MAX_AGE_HOURS.submit * 3_600_000).map((e) => e.platform));
      const next = live.platforms.length
        ? `Live ads: ${platformWords(live.platforms)}. ${done.size < 2 ? "Record the other library too, then write" : "Write"} the slots (the ads template) about the best-ranked fault and submit.`
        : done.size < 2
          ? "No live ads in this library. Check the other one."
          : 'Neither library shows live ads pointing to their website: drop it with the reason "no live ads".';
      return { text: `Recorded the ${platform === "meta" ? "Meta Ad Library" : "Google Ads Transparency Centre"} check: ${read.evidence.note}. ${next}` };
    },
  },
  {
    name: "outreach_preview",
    title: "Read a business's emails",
    description: "The stored subject and body of a business's emails, with their status and due day, as Pulse holds them (re-rendered with the confirming run's figures once confirmed). Read only.",
    inputSchema: { type: "object", properties: { prospect_id: ID }, required: ["prospect_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(a, ctx) {
      const p = await prospectOf(ctx, need(a, "prospect_id", 40));
      const { data } = await ctx.sb.from("outreach_messages").select("kind, status, send_on, subject, body, drop_reason").eq("prospect_id", p.id).order("kind");
      const rows = (data as { kind: string; status: string; send_on: string | null; subject: string | null; body: string | null; drop_reason: string | null }[] | null) ?? [];
      if (!rows.length) return { text: `${p.business_name ?? "This business"} has no emails yet.` };
      return {
        text: rows
          .map((m) => `${m.kind === "first" ? "FIRST EMAIL" : "FOLLOW-UP"} (${m.status}${m.send_on ? `, due ${m.send_on}` : ""}${m.drop_reason ? `: ${m.drop_reason}` : ""})\nSubject: ${m.subject ?? ""}\n\n${m.body ?? ""}`)
          .join("\n\n----------\n\n"),
      };
    },
  },

  {
    name: "outreach_queue",
    title: "What's waiting",
    description: "Every email not yet sent: the business, first email or follow-up, its status (being checked, queued), and the day it's due. Read only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(_a, ctx) {
      const { data } = await ctx.sb
        .from("outreach_messages")
        .select("prospect_id, kind, status, send_on, fault, created_at")
        .in("status", ["awaiting_confirmation", "queued", "sending"])
        .order("created_at")
        .limit(100);
      const rows = (data as { prospect_id: string; kind: string; status: string; send_on: string | null; fault: Fault | null; created_at: string }[] | null) ?? [];
      if (!rows.length) return { text: "Nothing is waiting." };
      const { data: ps } = await ctx.sb.from("outreach_prospects").select("id, business_name, found_on, test").in("id", [...new Set(rows.map((r) => r.prospect_id))]);
      const p = new Map(((ps as { id: string; business_name: string | null; found_on: string; test: boolean }[] | null) ?? []).map((x) => [x.id, x]));
      return {
        text: rows
          .map((r) => {
            const x = p.get(r.prospect_id);
            return `${x?.business_name ?? "A business"} (prospect_id ${r.prospect_id}, found ${x?.found_on ?? "?"}${x?.test ? ", test" : ""}): ${r.kind === "first" ? "first email" : "follow-up"}, ${r.status === "awaiting_confirmation" ? "being checked" : r.status}${r.send_on ? `, due ${r.send_on}` : ""}, about ${r.fault ? FAULT_LABEL[r.fault].toLowerCase() : "?"}.`;
          })
          .join("\n"),
      };
    },
  },

  // ---------- the advisor's writes ----------
  {
    name: "outreach_clear_unsent",
    title: "Clear a day's unsent work",
    description:
      "Remove every business the morning run found on one day that has never been emailed, with its drafts and measurements, so a later run can look at them afresh. For when Kyle has said to clear a run (for example one made under rules he has since changed). Never touches a business that has been emailed, test businesses, or businesses added by hand. Pass confirm: \"clear\". Only after Kyle has said yes in this chat.",
    inputSchema: {
      type: "object",
      properties: {
        found_on: { type: "string", description: "The day the run found them, YYYY-MM-DD (Melbourne)." },
        confirm: { type: "string", description: "Must be exactly \"clear\"." },
      },
      required: ["found_on", "confirm"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    advisorOnly: true,
    async run(a, ctx) {
      const day = need(a, "found_on", 10);
      if (!DATE_RE.test(day)) throw new InputError("found_on is YYYY-MM-DD.");
      if (str(a, "confirm", 10) !== "clear") throw new InputError('Pass confirm: "clear" once Kyle has said yes.');
      const { data: ps } = await ctx.sb.from("outreach_prospects").select("id, business_name").eq("source", "claude_run").eq("test", false).eq("found_on", day);
      const all = (ps as { id: string; business_name: string | null }[] | null) ?? [];
      if (!all.length) return { text: `The run found nothing on ${day}.` };
      const { data: sent } = await ctx.sb.from("outreach_messages").select("prospect_id").in("prospect_id", all.map((p) => p.id)).not("sent_at", "is", null);
      const emailed = new Set(((sent as { prospect_id: string }[] | null) ?? []).map((m) => m.prospect_id));
      const clear = all.filter((p) => !emailed.has(p.id));
      if (!clear.length) return { text: `Every business found on ${day} has been emailed; nothing was cleared.` };
      // The unsent drafts go first, taking their claims with them: a claim
      // points at a measurement, so removing the business (which takes its
      // measurements) while a claim still stands is refused. Then the business,
      // with its measurements, contact and events. Nothing was fingerprinted:
      // that happens only when a business is really emailed.
      const ids = clear.map((p) => p.id);
      const { error: mErr } = await ctx.sb.from("outreach_messages").delete().in("prospect_id", ids).is("sent_at", null);
      if (mErr) throw new Error(mErr.message);
      const { error } = await ctx.sb.from("outreach_prospects").delete().in("id", ids);
      if (error) throw new Error(error.message);
      const names = clear.map((p) => p.business_name ?? "A business");
      await log(ctx, `Cleared ${clear.length} unsent business${clear.length === 1 ? "" : "es"} found ${day}`, names.join("; ").slice(0, 1000));
      return { text: `Cleared ${clear.length} (never emailed): ${names.join(", ")}.${emailed.size ? ` Kept ${emailed.size} already emailed.` : ""}` };
    },
  },
  {
    name: "outreach_set_template",
    title: "Install a template",
    description:
      "Install a template written in Pulse's code as the next template version (or find it, if it's already installed) and move lanes onto it. \"ads\" is template 2 from Draper plan 2 (22 November 2026): live ads from the ad libraries, one best-ranked fault, the /work proof line, a named offer, optional follow-up. Only after Kyle has said yes in this chat.",
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", enum: ["ads"] },
        lane_ids: { type: "array", items: { type: "integer" }, description: "The lanes to move onto it." },
        why: { type: "string", description: "What changed and why, for the change log." },
      },
      required: ["template", "lane_ids", "why"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    advisorOnly: true,
    async run(a, ctx) {
      if (need(a, "template", 10) !== "ads") throw new InputError('template is "ads".');
      const why = need(a, "why", 1000);
      const laneIds = Array.isArray(a.lane_ids) ? (a.lane_ids as unknown[]).filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x > 0 && x < 100) : [];
      if (!laneIds.length) throw new InputError("lane_ids lists the lanes to move onto it.");
      const t = TEMPLATE_ADS;
      const { data: rows, error: rErr } = await ctx.sb.from("outreach_templates").select("version, first_subject, first_body, followup_body").order("version", { ascending: false });
      if (rErr) throw new Error(rErr.message);
      const all = (rows as { version: number; first_subject: string; first_body: string; followup_body: string }[] | null) ?? [];
      let version = all.find((r) => r.first_subject === t.first_subject && r.first_body === t.first_body && r.followup_body === t.followup_body)?.version;
      const installed = !version;
      if (!version) {
        version = (all[0]?.version ?? 0) + 1;
        const { error } = await ctx.sb.from("outreach_templates").insert({
          version,
          first_subject: t.first_subject,
          first_body: t.first_body,
          followup_subject: t.followup_subject,
          followup_body: t.followup_body,
          opt_out_a: t.opt_out_a,
          opt_out_b: t.opt_out_b,
          slot_rules: t.slot_rules,
          example: t.example,
          note: t.note,
          created_by: "claude (advisor)",
        });
        if (error) throw new Error(error.message);
      }
      const { data: moved, error: lErr } = await ctx.sb.from("outreach_lanes").update({ template_version: version }).in("id", laneIds).select("id");
      if (lErr) throw new Error(lErr.message);
      const ids = ((moved as { id: number }[] | null) ?? []).map((l) => l.id);
      await log(ctx, `Template ${version} (ads) ${installed ? "installed" : "already installed"}; lanes ${ids.join(", ") || "none"} moved onto it`, why);
      return { text: `Template ${version} (ads) ${installed ? "installed" : "was already installed"}. Lanes now on it: ${ids.join(", ") || "none (check the lane ids)"}.` };
    },
  },
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

export const DRAPER_INSTRUCTIONS = `This is Draper, Hartwell Digital's outreach desk in Hartwell Pulse. You find small businesses whose Google or Meta ads are live and whose website, where those ads send people, has a fault Pulse can measure, and hand Pulse what it needs to write to them. You never send anything: Pulse sends from Kyle's mailbox, on its own clock, after checking everything again itself.

Start every run with outreach_brief and follow its run instructions, and end every run with outreach_finish_run. Work only in the active lane and stop at the target. Check every business with outreach_check_business before reading its site. Never guess an email address, build one from a pattern, or take one from a directory. Never write a number, a weekday, a month, a page name or a place in a slot: use the tokens. Ads are only ever proven by the ad libraries' own pages, read in a browser and handed to Pulse with outreach_record_ads; never click an ad. Write in Australian English.`;

export const ADVISOR_INSTRUCTIONS = `${DRAPER_INSTRUCTIONS}

This is the advisor connector. It can also write the lessons, the run instructions, the test register and the template, and clear a day's never-emailed work, but only ever after Kyle has said yes to that exact change in this chat.`;
