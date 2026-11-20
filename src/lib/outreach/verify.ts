/**
 * outreach_submit's decision, pure (Stage 4). Given what Pulse has on record
 * for a prospect (SubmitContext, loaded by submit.ts) and Claude's draft
 * (SubmitInput), either every check passes and the two messages come back
 * ready to store, or the reasons come back for Claude to fix.
 *
 * The checks, from Kyle's brief step 4 and decisions 3 and 6:
 *   - each claim names a measurement of THIS prospect that showed the fault,
 *     the fault isn't switched off, and the site has the ad signal;
 *   - every figure, day, page name and place is a token Pulse fills from its
 *     own records (tokens.ts), never something Claude typed;
 *   - the lint passes (lint.ts);
 *   - at least two things in the first email are true only of this business;
 *   - Kyle's fixed text arrives unchanged (render.ts).
 * The no-repeat check and the contact page re-fetch need the network, so
 * submit.ts runs them around this.
 */
import type { Fault } from "./rules.ts";
import { FAULT_LABEL } from "./rules.ts";
import { describe, lintSlots, SLOTS, type SlotName } from "./lint.ts";
import { renderMessages, type TemplateText } from "./render.ts";
import {
  allowedAreas,
  FAULT_TOKENS,
  isToken,
  melbourneWeekday,
  nameKey,
  pageNamesFor,
  secondsWords,
  timesWords,
  tokensIn,
  type Token,
} from "./tokens.ts";

export interface SubmitInput {
  prospect_id: string;
  page_name: string;
  area?: string | null;
  broken_page_name?: string | null;
  slots: Record<SlotName, string>;
  claims: { fault: Fault; measurement_id: string; slot: SlotName }[];
  personal_count: number;
  template_version: number;
  subject?: string | null;
}

export interface MeasurementRow {
  id: string;
  prospect_id: string;
  url: string;
  status: "ok" | "blocked" | "failed";
  measured_at: string;
  psi_fcp_ms: number | null;
  psi_lcp_ms: number | null;
  menu_links: { url: string; label: string; status: number | null; blocked: boolean }[];
  pixel_pageviews: Record<string, number>;
  ad_signal: boolean | null;
  faults: Fault[];
}

export interface SubmitContext {
  prospect: { id: string; status: string; suburb: string | null; postcode: string | null; lane_id: number | null };
  contact: { email: string; first_name: string | null; address_kind: string | null; mx_provider: string | null } | null;
  lane: { id: number; template_version: number; approval_required: boolean; active: boolean } | null;
  template: TemplateText & { version: number };
  settings: { version: number; opt_out_line: "A" | "B" };
  faultsOff: Fault[];
  measurements: MeasurementRow[];
  existingMessages: number;
  /** Earlier refusals of a draft for this prospect. */
  refusals: number;
}

export interface MessageDraft {
  kind: "first" | "follow_up";
  subject: string;
  body: string;
  slots: Record<string, string | null>;
  fault: Fault;
  template_version: number;
  personal_count: number;
  personal_backed: number;
  status: "awaiting_confirmation";
  needs_approval: boolean;
  lane_id: number;
  address_kind: string | null;
  mx_provider: string | null;
}

export type Verified =
  | {
      ok: true;
      first: MessageDraft;
      followUp: MessageDraft;
      claims: { message: "first" | "follow_up"; measurement_id: string; fault: Fault; slot: SlotName; quote: string }[];
    }
  | { ok: false; reasons: string[] };

const BROKEN = (s: number | null) => s !== null && (s === 404 || s === 410 || s >= 500);

export function verifySubmission(ctx: SubmitContext, input: SubmitInput): Verified {
  const reasons: string[] = [];
  const no = (r: string) => reasons.push(r);

  if (ctx.refusals >= 2) {
    return { ok: false, reasons: ["Refused twice already. Drop this prospect with outreach_drop."] };
  }
  if (!["found", "measured"].includes(ctx.prospect.status)) no(`This prospect is ${ctx.prospect.status}, not open for a draft.`);
  if (ctx.existingMessages > 0) no("This prospect already has its emails. One approach per business.");
  if (!ctx.contact) no("No published contact address is on file for this prospect.");
  if (!ctx.lane) no("This prospect has no lane.");
  else {
    if (!ctx.lane.active) no("This prospect's lane isn't the active lane.");
    if (input.template_version !== ctx.lane.template_version || input.template_version !== ctx.template.version) {
      no(`Use template version ${ctx.lane.template_version}, the one this lane is on.`);
    }
  }
  if (!Number.isFinite(input.personal_count) || input.personal_count < 2) {
    no("personal_count must be 2 or more: at least two sentences true only of this business.");
  }

  // ---------- the claims ----------
  const byId = new Map(ctx.measurements.map((m) => [m.id, m]));
  const off = new Set(ctx.faultsOff);
  const faultOf = (slot: SlotName) => [...new Set(input.claims.filter((c) => c.slot === slot).map((c) => c.fault))];
  const firstFaults = [...new Set([...faultOf("finding"), ...faultOf("why_and_fix")])];
  const secondFaults = faultOf("second_finding");
  if (firstFaults.length !== 1) no("The first email must claim exactly one fault, in {finding} (and {why_and_fix} if it mentions it).");
  if (secondFaults.length !== 1) no("The follow-up must claim exactly one fault, in {second_finding}.");
  const firstFault = firstFaults[0];
  const secondFault = secondFaults[0];
  if (firstFault && secondFault && firstFault === secondFault) no("The two emails must be about two different faults.");

  const measurementFor = new Map<SlotName, MeasurementRow>();
  for (const c of input.claims) {
    const m = byId.get(c.measurement_id);
    if (!m || m.prospect_id !== ctx.prospect.id) {
      no(`The ${FAULT_LABEL[c.fault] ?? c.fault} claim in {${c.slot}} has no measurement of this business behind it.`);
      continue;
    }
    if (m.status !== "ok") no(`Measurement ${m.id} couldn't read the page, so it can't back a claim.`);
    else if (!m.faults.includes(c.fault)) no(`Measurement ${m.id} didn't show "${FAULT_LABEL[c.fault] ?? c.fault}".`);
    if (off.has(c.fault)) no(`"${FAULT_LABEL[c.fault]}" is switched off after two wrong-fact labels.`);
    if (!measurementFor.has(c.slot)) measurementFor.set(c.slot, m);
  }
  if (!ctx.measurements.some((m) => m.status === "ok" && m.ad_signal)) {
    no("No measurement found a Google Ads tag or a Meta Pixel. Without the ad signal it doesn't qualify.");
  }
  const onRecord = new Set(ctx.measurements.filter((m) => m.status === "ok").flatMap((m) => m.faults).filter((f) => !off.has(f)));
  const otherFaults = firstFault ? [...onRecord].filter((f) => f !== firstFault).length : 0;

  // ---------- the tokens ----------
  const firstMeasurement = measurementFor.get("finding") ?? measurementFor.get("why_and_fix");

  // page_name names the subject, so it is always checked: the measured page's
  // own address or its menu label, or the broken page for a broken-page email.
  const pageOk = (() => {
    const want = nameKey(input.page_name);
    if (!want || !firstMeasurement) return false;
    const labels = firstMeasurement.menu_links.filter((l) => l.url === firstMeasurement.url).map((l) => l.label);
    if (pageNamesFor(firstMeasurement.url, labels).has(want)) return true;
    return (
      firstFault === "broken_page" &&
      firstMeasurement.menu_links.some((l) => BROKEN(l.status) && (nameKey(l.label) === want || pageNamesFor(l.url).has(want)))
    );
  })();
  const areaOk = !input.area || allowedAreas(ctx.prospect).has(nameKey(input.area));
  if (!pageOk) no(`page_name "${input.page_name}" doesn't match the measured page's address or menu label.`);
  if (input.area && !areaOk) no(`area "${input.area}" isn't this business's suburb or its postcode's region.`);

  const filled = {} as Record<SlotName, string>;
  const used = new Set<Token>();
  for (const slot of SLOTS) {
    const raw = input.slots[slot] ?? "";
    const fault = slot === "second_finding" ? secondFault : firstFault;
    const m = measurementFor.get(slot) ?? (slot === "why_and_fix" ? firstMeasurement : undefined);
    filled[slot] = raw.replace(/\[\[\s*([a-z_]+)\s*\]\]/g, (whole, name: string) => {
      if (!isToken(name)) return whole; // the lint names it
      const value = fillToken(name, slot, fault, m);
      if (value === null) return whole;
      if (slot !== "second_finding") used.add(name);
      return value;
    });
  }

  function fillToken(name: Token, slot: SlotName, fault: Fault | undefined, m: MeasurementRow | undefined): string | null {
    const allowedFor = Object.entries(FAULT_TOKENS).find(([, ts]) => ts?.includes(name))?.[0] as Fault | undefined;
    if (allowedFor && fault !== allowedFor) {
      no(`[[${name}]] in {${slot}} only goes with "${FAULT_LABEL[allowedFor]}".`);
      return null;
    }
    if (!m) {
      no(`[[${name}]] in {${slot}} has no claimed measurement to come from.`);
      return null;
    }
    switch (name) {
      case "day":
        return melbourneWeekday(m.measured_at);
      case "first_paint":
        if ((m.psi_fcp_ms ?? 0) < 4000) {
          no(`[[first_paint]] in {${slot}}: the first paint wasn't slow (4 seconds or more) on that measurement.`);
          return null;
        }
        return secondsWords(m.psi_fcp_ms!);
      case "largest_paint":
        if ((m.psi_lcp_ms ?? 0) < 6000) {
          no(`[[largest_paint]] in {${slot}}: the largest paint wasn't slow (6 seconds or more) on that measurement.`);
          return null;
        }
        return secondsWords(m.psi_lcp_ms!);
      case "pageviews": {
        const most = Math.max(0, ...Object.values(m.pixel_pageviews ?? {}));
        if (most < 2) {
          no(`[[pageviews]] in {${slot}}: no pixel counted a visit twice on that measurement.`);
          return null;
        }
        return timesWords(most);
      }
      case "broken_page": {
        const want = nameKey(input.broken_page_name);
        const hit = m.menu_links.find(
          (l) => !l.blocked && BROKEN(l.status) && (nameKey(l.label) === want || pageNamesFor(l.url).has(want)),
        );
        if (!want || !hit) {
          no(`[[broken_page]] in {${slot}}: broken_page_name must be the name of a menu page that returned an error on that measurement.`);
          return null;
        }
        return input.broken_page_name!.trim();
      }
      case "page": {
        if (!pageOk) {
          no(`[[page]] in {${slot}}: page_name must match the measured page.`);
          return null;
        }
        return input.page_name.trim();
      }
      case "area": {
        if (!areaOk) {
          no(`[[area]] in {${slot}}: area must be the business's own suburb or the region its postcode is in.`);
          return null;
        }
        return (input.area ?? "").trim();
      }
    }
  }

  // ---------- the lint ----------
  for (const r of describe(lintSlots(input.slots, filled))) no(r);

  // ---------- personal ----------
  // Facts true only of this business in the first email: each token Pulse
  // filled from its records, and the fault itself.
  const personalBacked = used.size + (firstFault ? 1 : 0);
  if (personalBacked < 2) {
    no("Fewer than two things in the first email are backed by this business's own measurements. Use tokens like [[page]], [[day]] or [[area]].");
  }

  if (reasons.length > 0 || !firstFault || !secondFault || !ctx.contact || !ctx.lane) {
    return { ok: false, reasons: [...new Set(reasons)] };
  }

  // ---------- render ----------
  const r = renderMessages(ctx.template, {
    pageName: input.page_name,
    firstName: ctx.contact.first_name,
    otherFaults,
    optOut: ctx.settings.opt_out_line,
    slots: filled,
  });
  if (r.problems.length) return { ok: false, reasons: r.problems };
  if (input.subject && input.subject.trim().toLowerCase() !== r.first.subject.toLowerCase()) {
    return { ok: false, reasons: [`The subject is fixed by the template: "${r.first.subject}".`] };
  }

  const common = {
    template_version: input.template_version,
    personal_count: Math.floor(input.personal_count),
    personal_backed: personalBacked,
    status: "awaiting_confirmation" as const,
    needs_approval: ctx.lane.approval_required,
    lane_id: ctx.lane.id,
    address_kind: ctx.contact.address_kind,
    mx_provider: ctx.contact.mx_provider,
  };
  return {
    ok: true,
    first: {
      ...common,
      kind: "first",
      ...r.first,
      fault: firstFault,
      slots: {
        finding: input.slots.finding,
        why_and_fix: input.slots.why_and_fix,
        page_name: input.page_name.trim(),
        area: input.area?.trim() || null,
        broken_page_name: input.broken_page_name?.trim() || null,
      },
    },
    followUp: {
      ...common,
      kind: "follow_up",
      ...r.followUp,
      fault: secondFault,
      slots: { second_finding: input.slots.second_finding, broken_page_name: input.broken_page_name?.trim() || null },
    },
    claims: input.claims.map((c) => ({
      message: c.slot === "second_finding" ? ("follow_up" as const) : ("first" as const),
      measurement_id: c.measurement_id,
      fault: c.fault,
      slot: c.slot,
      quote: input.slots[c.slot] ?? "",
    })),
  };
}
