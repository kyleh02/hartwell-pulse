import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { businessToday } from "@/lib/business-time";
import {
  STAGES,
  SOURCE_LABEL,
  STAGE_LABEL,
  addDays,
  followUpState,
  isLeadStage,
  leadTitle,
  money,
  shortDate,
  type Lead,
  type LeadActivity,
  type LeadStage,
} from "@/lib/pipeline-shared";
import { onDoNotContact } from "@/lib/pipeline";
import { createLeadOp, logActivityOp, moveLeadOp, updateLeadOp, type LeadInput } from "@/lib/pipeline-ops";

/**
 * What Claude can do with Kyle's pipeline, as MCP tools.
 *
 * The line is drawn at anything that reaches a person or cannot be undone.
 * Claude reads, adds, updates, moves and logs. It cannot mark a lead won
 * (that creates a portal and emails a welcome, so it stays a button Kyle
 * presses), cannot delete, and cannot email anyone. The writes go through the
 * same functions as the portal's own buttons (`pipeline-ops.ts`).
 *
 * Results are plain text written for the model to read back to Kyle, each lead
 * with its id (for the next call) and its portal link (for Kyle).
 */

export interface ToolContext {
  sb: SupabaseClient;
  origin: string;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

type Args = Record<string, unknown>;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  run: (args: Args, ctx: ToolContext) => Promise<ToolResult>;
}

const ACTOR = "claude";
const OPEN_STAGES = STAGES.filter((s) => s.open).map((s) => s.key);
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "A date as YYYY-MM-DD, Melbourne time." };
const LEAD_ID = { type: "string", description: "The lead's id, from list_leads, follow_ups_due or get_lead." };

class InputError extends Error {}

function str(args: Args, key: string, max = 4000): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new InputError(`${key} must be text.`);
  return v.slice(0, max);
}
function date(args: Args, key: string): string | null | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new InputError(`${key} must be a date as YYYY-MM-DD.`);
  }
  return v;
}
function leadId(args: Args): string {
  const v = args.lead_id;
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new InputError("lead_id must be a lead's id (a UUID).");
  return v;
}

const link = (ctx: ToolContext, id: string) => `${ctx.origin}/admin/pipeline/${id}`;

function line(l: Lead, ctx: ToolContext, today: string): string {
  const who = l.business && l.name ? `${l.business} (${l.name})` : leadTitle(l);
  const state = followUpState(l, today);
  const follow =
    state === "overdue"
      ? `follow-up was due ${shortDate(l.follow_up_on)} (overdue)`
      : state === "today"
        ? "follow up today"
        : state === "later"
          ? `follow up ${shortDate(l.follow_up_on)}`
          : l.stage === "won" || l.stage === "lost"
            ? null
            : "no follow-up set";
  const bits = [STAGE_LABEL[l.stage], money(l.value), follow, l.next_action ? `next: ${l.next_action}` : null].filter(Boolean);
  return `- ${who}: ${bits.join(", ")}\n  id ${l.id} · ${link(ctx, l.id)}`;
}

async function readLead(ctx: ToolContext, id: string): Promise<Lead | null> {
  const { data } = await ctx.sb.from("leads").select("*").eq("id", id).maybeSingle();
  return (data as Lead | null) ?? null;
}

async function openLeads(ctx: ToolContext): Promise<Lead[]> {
  const { data, error } = await ctx.sb.from("leads").select("*").in("stage", OPEN_STAGES).order("follow_up_on", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Lead[] | null) ?? [];
}

function leadInput(args: Args): LeadInput {
  const input: LeadInput = {};
  for (const [k, max] of [
    ["name", 120],
    ["business", 160],
    ["email", 200],
    ["phone", 40],
    ["website", 300],
    ["service", 300],
    ["next_action", 300],
    ["notes", 8000],
  ] as const) {
    const v = str(args, k, max);
    if (v !== undefined) input[k] = v;
  }
  if (args.source !== undefined) {
    const s = str(args, "source");
    if (!s || !(s in SOURCE_LABEL)) throw new InputError(`source must be one of: ${Object.keys(SOURCE_LABEL).join(", ")}.`);
    input.source = s;
  }
  if (args.value !== undefined) {
    if (args.value !== null && (typeof args.value !== "number" || !Number.isFinite(args.value) || args.value < 0)) {
      throw new InputError("value must be a number of dollars.");
    }
    input.value = args.value as number | null;
  }
  const f = date(args, "follow_up_on");
  if (f !== undefined) input.follow_up_on = f;
  return input;
}

const LEAD_FIELDS = {
  name: { type: "string", description: "The person's name." },
  business: { type: "string", description: "Their business." },
  email: { type: "string" },
  phone: { type: "string" },
  website: { type: "string" },
  source: { type: "string", enum: Object.keys(SOURCE_LABEL), description: "Where the lead came from." },
  service: { type: "string", description: "What they are after, e.g. a new website or Google Ads." },
  value: { type: ["number", "null"], description: "Roughly what the work is worth, in Australian dollars." },
  next_action: { type: "string", description: "The next thing Kyle needs to do, in a few words." },
  notes: { type: "string", description: "Anything worth remembering about them." },
  follow_up_on: { ...DATE, description: "When Kyle should next follow up, YYYY-MM-DD. It lands on his dashboard that morning." },
};

export const TOOLS: ToolDef[] = [
  {
    name: "pipeline_overview",
    title: "Pipeline overview",
    description:
      "Start here. Today's date, how many leads sit in each stage, what the open ones are worth, and every follow-up due today or overdue.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(_a, ctx) {
      const today = businessToday();
      const { data, error } = await ctx.sb.from("leads").select("*");
      if (error) throw new Error(error.message);
      const all = (data as Lead[] | null) ?? [];
      const counts = STAGES.map((s) => `${s.label} ${all.filter((l) => l.stage === s.key).length}`).join(", ");
      const open = all.filter((l) => OPEN_STAGES.includes(l.stage));
      const worth = open.reduce((s, l) => s + (Number(l.value) || 0), 0);
      const due = open
        .filter((l) => ["overdue", "today"].includes(followUpState(l, today)))
        .sort((a, b) => (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? ""));
      return {
        text: [
          `Today is ${shortDate(today)} ${today.slice(0, 4)} (${today}) in Melbourne.`,
          `Leads by stage: ${counts}.`,
          `Open leads: ${open.length}${worth > 0 ? `, worth ${money(worth)} together` : ""}.`,
          due.length ? `Follow-ups due today or overdue (${due.length}):\n${due.map((l) => line(l, ctx, today)).join("\n")}` : "Nothing is due today.",
        ].join("\n"),
      };
    },
  },
  {
    name: "list_leads",
    title: "List leads",
    description:
      "List leads, soonest follow-up first. By default only open leads (New, Contacted, Meeting, Proposal). Filter by stage, or search names, businesses and emails.",
    inputSchema: {
      type: "object",
      properties: {
        stage: { type: "string", enum: STAGES.map((s) => s.key), description: "Only this stage." },
        search: { type: "string", description: "Part of a name, business or email." },
        include_closed: { type: "boolean", description: "Include won and lost leads. Default false." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 50." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, ctx) {
      const today = businessToday();
      const stage = str(args, "stage");
      if (stage && !isLeadStage(stage)) throw new InputError("stage is not one of the pipeline's stages.");
      const search = str(args, "search", 100)?.trim().toLowerCase();
      const limit = typeof args.limit === "number" ? Math.min(100, Math.max(1, Math.floor(args.limit))) : 50;
      let q = ctx.sb.from("leads").select("*");
      if (stage) q = q.eq("stage", stage);
      else if (args.include_closed !== true) q = q.in("stage", OPEN_STAGES);
      const { data, error } = await q.order("follow_up_on", { ascending: true });
      if (error) throw new Error(error.message);
      let rows = (data as Lead[] | null) ?? [];
      if (search) rows = rows.filter((l) => [l.name, l.business, l.email].some((v) => v?.toLowerCase().includes(search)));
      const shown = rows.slice(0, limit);
      if (!shown.length) return { text: "No leads match." };
      return {
        text: `${rows.length} lead${rows.length === 1 ? "" : "s"}${rows.length > shown.length ? `, showing ${shown.length}` : ""}:\n${shown.map((l) => line(l, ctx, today)).join("\n")}`,
      };
    },
  },
  {
    name: "get_lead",
    title: "Get a lead",
    description: "Everything about one lead: details, notes, its activity log, and whether the address is on the do-not-contact list.",
    inputSchema: { type: "object", properties: { lead_id: LEAD_ID }, required: ["lead_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, ctx) {
      const id = leadId(args);
      const l = await readLead(ctx, id);
      if (!l) return { text: "No lead has that id.", isError: true };
      const { data } = await ctx.sb.from("lead_activity").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(30);
      const acts = (data as LeadActivity[] | null) ?? [];
      const dnc = l.email ? await onDoNotContact(ctx.sb, l.email) : null;
      const row = (k: string, v: string | null | undefined) => (v ? `${k}: ${v}` : null);
      return {
        text: [
          leadTitle(l),
          row("Name", l.name),
          row("Business", l.business),
          row("Email", l.email),
          row("Phone", l.phone),
          row("Website", l.website),
          row("Stage", STAGE_LABEL[l.stage]),
          row("Source", SOURCE_LABEL[l.source]),
          row("Wants", l.service),
          row("Worth", money(l.value)),
          row("Next action", l.next_action),
          row("Follow up", l.follow_up_on ? `${shortDate(l.follow_up_on)} (${l.follow_up_on})` : null),
          row("Lost because", l.lost_reason),
          row("Notes", l.notes),
          dnc ? `WARNING: ${l.email} is on the do-not-contact list (${dnc.reason}). Do not suggest writing to them unless they wrote first.` : null,
          `id ${l.id} · ${link(ctx, l.id)}`,
          acts.length
            ? `Activity, newest first:\n${acts.map((a) => `- ${a.created_at.slice(0, 10)} ${a.kind}${a.body ? `: ${a.body}` : ""}`).join("\n")}`
            : "No activity logged.",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    },
  },
  {
    name: "follow_ups_due",
    title: "Follow-ups due",
    description: "Open leads whose follow-up is overdue, due today, or due within the next few days.",
    inputSchema: {
      type: "object",
      properties: { days_ahead: { type: "integer", minimum: 0, maximum: 60, description: "How far ahead to look. Default 0, today only." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, ctx) {
      const today = businessToday();
      const ahead = typeof args.days_ahead === "number" ? Math.min(60, Math.max(0, Math.floor(args.days_ahead))) : 0;
      const until = addDays(today, ahead);
      const open = await openLeads(ctx);
      const due = open.filter((l) => l.follow_up_on && l.follow_up_on <= until);
      const none = open.filter((l) => !l.follow_up_on);
      return {
        text: [
          `Today is ${today}.`,
          due.length ? `Due by ${until} (${due.length}):\n${due.map((l) => line(l, ctx, today)).join("\n")}` : `Nothing due by ${until}.`,
          none.length ? `Open leads with no follow-up date (${none.length}), which nothing will remind Kyle about:\n${none.map((l) => line(l, ctx, today)).join("\n")}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    },
  },
  {
    name: "add_lead",
    title: "Add a lead",
    description:
      "Add someone to the pipeline as a New lead. Needs at least a name, a business or an email. Follow-up defaults to tomorrow. Refuses a duplicate of an open lead with the same email, and warns if the address is on the do-not-contact list.",
    inputSchema: { type: "object", properties: LEAD_FIELDS, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, ctx) {
      const input = leadInput(args);
      if (input.email) {
        const { data } = await ctx.sb.from("leads").select("*").in("stage", OPEN_STAGES).ilike("email", input.email.trim().replace(/[\\%_]/g, (c) => `\\${c}`));
        const dup = ((data as Lead[] | null) ?? [])[0];
        if (dup) {
          return {
            text: `There is already an open lead for ${input.email}: ${leadTitle(dup)}, id ${dup.id}. Update it or log activity on it instead.`,
            isError: true,
          };
        }
      }
      const res = await createLeadOp(ctx.sb, ACTOR, input, "Added from Claude");
      if (!res.ok) return { text: res.message, isError: true };
      const l = await readLead(ctx, res.id);
      return { text: [`Added.`, l ? line(l, ctx, businessToday()) : `id ${res.id}`, res.warning ? `WARNING: ${res.warning}` : null].filter(Boolean).join("\n") };
    },
  },
  {
    name: "update_lead",
    title: "Update a lead",
    description: "Change a lead's details, next action, notes or follow-up date. Only the fields given change. Use move_lead to change its stage.",
    inputSchema: { type: "object", properties: { lead_id: LEAD_ID, ...LEAD_FIELDS }, required: ["lead_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, ctx) {
      const id = leadId(args);
      const rest = { ...args };
      delete rest.lead_id;
      const input = leadInput(rest);
      if (!Object.keys(input).length) return { text: "Nothing to change: give at least one field.", isError: true };
      const res = await updateLeadOp(ctx.sb, id, input);
      if (!res.ok) return { text: res.message, isError: true };
      const l = await readLead(ctx, id);
      return { text: `Updated.\n${l ? line(l, ctx, businessToday()) : ""}` };
    },
  },
  {
    name: "move_lead",
    title: "Move a lead",
    description:
      "Move a lead to another stage: new, contacted, meeting, proposal or lost (give lost_reason). Won is not available here: marking a lead won creates their portal and emails them a welcome, so Kyle does it with the They said yes button on the lead's page.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: LEAD_ID,
        stage: { type: "string", enum: ["new", "contacted", "meeting", "proposal", "lost"] },
        lost_reason: { type: "string", description: "Why it was lost, when stage is lost." },
      },
      required: ["lead_id", "stage"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, ctx) {
      const id = leadId(args);
      const stage = str(args, "stage") as LeadStage | undefined;
      if (stage === "won") {
        return { text: `Won can't be set from here. Open ${link(ctx, id)} and press They said yes: it sets up their portal and sends the welcome.`, isError: true };
      }
      if (!stage || !isLeadStage(stage)) throw new InputError("stage must be new, contacted, meeting, proposal or lost.");
      const res = await moveLeadOp(ctx.sb, ACTOR, id, stage, str(args, "lost_reason", 300));
      if (!res.ok) return { text: res.message, isError: true };
      const l = await readLead(ctx, id);
      return { text: `Moved to ${STAGE_LABEL[stage]}.\n${l ? line(l, ctx, businessToday()) : ""}` };
    },
  },
  {
    name: "log_activity",
    title: "Log activity",
    description:
      "Record a call, email, meeting or note against a lead, optionally setting the next follow-up date at the same time. Logging contact on a New lead moves it to Contacted.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: LEAD_ID,
        kind: { type: "string", enum: ["call", "email", "meeting", "note"] },
        body: { type: "string", description: "What happened, in a sentence or two." },
        follow_up_on: { ...DATE, description: "Optional: when to follow up next, YYYY-MM-DD." },
        next_action: { type: "string", description: "Optional: the next thing to do." },
      },
      required: ["lead_id", "kind", "body"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(args, ctx) {
      const id = leadId(args);
      const kind = str(args, "kind");
      if (kind !== "call" && kind !== "email" && kind !== "meeting" && kind !== "note") throw new InputError("kind must be call, email, meeting or note.");
      const res = await logActivityOp(ctx.sb, ACTOR, id, kind, str(args, "body") ?? "");
      if (!res.ok) return { text: res.message, isError: true };
      const next: LeadInput = {};
      const f = date(args, "follow_up_on");
      if (f !== undefined) next.follow_up_on = f;
      const na = str(args, "next_action", 300);
      if (na !== undefined) next.next_action = na;
      if (Object.keys(next).length) await updateLeadOp(ctx.sb, id, next);
      const l = await readLead(ctx, id);
      return { text: `Logged.\n${l ? line(l, ctx, businessToday()) : ""}` };
    },
  },
  {
    name: "check_do_not_contact",
    title: "Check do-not-contact",
    description: "Is this email address on Kyle's do-not-contact list? Check before suggesting he write to someone new.",
    inputSchema: { type: "object", properties: { email: { type: "string" } }, required: ["email"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(args, ctx) {
      const email = str(args, "email", 200)?.trim();
      if (!email || !email.includes("@")) throw new InputError("email must be an email address.");
      const dnc = await onDoNotContact(ctx.sb, email);
      return { text: dnc ? `Yes. ${email} asked not to be contacted (${dnc.reason}, recorded ${dnc.recorded_at.slice(0, 10)}). Do not write to them.` : `No, ${email} is not on the list.` };
    },
  },
];

export async function callTool(name: string, args: Args, ctx: ToolContext): Promise<ToolResult | null> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  try {
    return await tool.run(args ?? {}, ctx);
  } catch (e) {
    if (e instanceof InputError) return { text: e.message, isError: true };
    console.error("[mcp] tool failed:", name, e);
    const msg = e instanceof Error ? e.message : String(e);
    return { text: /PGRST205|42P01|does not exist|schema cache/.test(msg) ? "The pipeline tables aren't set up yet: run migration 0056." : "That didn't work on the portal's side. Try again in a moment.", isError: true };
  }
}

export const INSTRUCTIONS = `This is Kyle's sales pipeline at Hartwell Digital, a small digital marketing business in Melbourne. Leads move New, Contacted, Meeting, Proposal, then Won or Lost, and every open lead should have a follow-up date, which lands on Kyle's dashboard that morning.

Call pipeline_overview first in a conversation: it gives today's date in Melbourne, so use it for any date you work out. Dates are YYYY-MM-DD.

You cannot mark a lead won, delete one, or email anyone. When a lead says yes, tell Kyle to press They said yes on the lead's page, and give him the link. If an address is on the do-not-contact list, say so plainly and never suggest writing to them unless they wrote first. Write in Australian English.`;
