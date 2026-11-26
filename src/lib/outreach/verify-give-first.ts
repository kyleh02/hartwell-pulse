/**
 * outreach_submit's decision for the give-first template (27 November 2026),
 * pure. Pulse writes both emails itself (give-first.ts), so what's checked is
 * whether there's anything true and strong enough to write:
 *   - the usual gates: open prospect, no emails yet, a published address, the
 *     active lane on this template, GST registered, refusals under two;
 *   - live ads from a fresh ad-library check;
 *   - a tracking gap on a platform those ads run on, on a measurement of this
 *     business that could tell (give-first.ts decides which);
 *   - the short name is the business's own, the lead word is from the list,
 *     and any quote is in the text of one of their live ads.
 * submit.ts loads the context and runs the network checks around this.
 */
import type { Fault } from "./rules.ts";
import { FAULT_LABEL } from "./rules.ts";
import { renderGiveFirst } from "./render.ts";
import type { MessageDraft, SubmitContext, Verified, MeasurementRow } from "./verify.ts";
import type { TrackingFacts } from "./measure-rules.ts";
import { libraryDate, type AdPlatform } from "./ads-rules.ts";
import { findQuote, giveFirstCopy, LEAD_WORDS, shortNameProblem, type LeadWord } from "./give-first.ts";
import { pageNamesFor } from "./tokens.ts";

export interface GiveFirstInput {
  prospect_id: string;
  template_version: number;
  short_name: string;
  lead_word: string;
  ad_quote?: string | null;
}

export interface GiveFirstContext extends Omit<SubmitContext, "measurements"> {
  prospect: SubmitContext["prospect"] & { business_name: string | null; domain: string | null };
  measurements: (MeasurementRow & { tracking: TrackingFacts | null })[];
  /** The newest Meta check: active ads on their domain, the earliest start, and the page text Pulse read. */
  meta: { ads: number; started: string | null; pageText: string } | null;
  /** Melbourne date, YYYY-MM-DD. */
  today: string;
}

export function verifyGiveFirst(ctx: GiveFirstContext, input: GiveFirstInput): Verified {
  const reasons: string[] = [];
  const no = (r: string) => reasons.push(r);

  if (ctx.refusals >= 2) return { ok: false, reasons: ["Refused twice already. Drop this prospect with outreach_drop."] };
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
  if (ctx.gstRegistered !== true) {
    no('The ABN record on file doesn\'t show this business registered for GST, the size floor. Drop it with the reason "not registered for GST".');
  }
  const live: AdPlatform[] = ctx.ads?.platforms ?? [];
  if (!live.length) {
    no('No ad-library check from the last 36 hours shows live ads for this business. Record both libraries with outreach_record_ads; if neither shows live ads pointing to their website, drop it with the reason "no live ads".');
  }

  const nameProblem = shortNameProblem(input.short_name ?? "", ctx.prospect.business_name);
  if (nameProblem) no(nameProblem);
  const leadWord = (input.lead_word ?? "").trim().toLowerCase();
  if (!(LEAD_WORDS as readonly string[]).includes(leadWord)) no(`lead_word must be one of: ${LEAD_WORDS.join(", ")}.`);

  let quote: { text: string; started: string | null } | null = null;
  if (input.ad_quote && input.ad_quote.trim()) {
    if (!live.includes("meta") || !ctx.meta) no("ad_quote needs a fresh Meta Ad Library check showing their live ads.");
    else if (!ctx.prospect.domain) no("No domain is on file to match the quote's ad against.");
    else {
      const found = findQuote(ctx.meta.pageText, ctx.prospect.domain, input.ad_quote, libraryDate);
      if (!found.ok) no(found.problem);
      else quote = { text: input.ad_quote.trim().replace(/\s+/g, " "), started: found.started };
    }
  }

  // The measurement behind the email: the newest one that could tell and
  // shows a gap for a platform their ads run on (give-first.ts decides).
  const off = new Set(ctx.faultsOff);
  const candidates = ctx.measurements.filter((m) => m.status === "ok" && m.tracking).sort((a, b) => b.measured_at.localeCompare(a.measured_at));
  let chosen: { m: (typeof candidates)[number]; copy: Extract<ReturnType<typeof giveFirstCopy>, { ok: true }>["copy"] } | null = null;
  let why = "";
  for (const m of candidates) {
    const r = giveFirstCopy({
      shortName: (input.short_name ?? "").trim(),
      leadWord: ((LEAD_WORDS as readonly string[]).includes(leadWord) ? leadWord : "enquiries") as LeadWord,
      live,
      meta: ctx.meta ? { ads: ctx.meta.ads, started: ctx.meta.started } : null,
      quote,
      faults: m.faults.filter((f) => !off.has(f)),
      pageviews: Math.max(0, ...Object.values(m.pixel_pageviews ?? {})),
      homePage: pageNamesFor(m.url).has("home"),
      tracking: { siteKind: m.tracking!.siteKind, gtm: m.tracking!.gtm.length > 0, gtmEmpty: m.tracking!.gtmEmpty },
      today: ctx.today,
    });
    if (r.ok) {
      chosen = { m, copy: r.copy };
      break;
    }
    why = r.reason;
  }
  if (!chosen) {
    no(
      candidates.length
        ? why
        : 'No measurement of this business has its tracking on record (it was measured before 28 November, or couldn\'t be read). Measure its home page again with outreach_measure, or drop it with the reason "no tracking gap".',
    );
  }
  const offClaimed = chosen?.copy.claimed.filter((f) => off.has(f)) ?? [];
  for (const f of offClaimed) no(`"${FAULT_LABEL[f]}" is switched off after two wrong-fact labels.`);

  if (reasons.length || !chosen || !ctx.contact || !ctx.lane) return { ok: false, reasons: [...new Set(reasons)] };

  const { m, copy } = chosen;
  const r = renderGiveFirst(ctx.template, {
    firstName: ctx.contact.first_name,
    optOut: ctx.settings.opt_out_line,
    gapPlatform: copy.gapPlatform,
    subjectTail: copy.subjectTail,
    finding: copy.finding,
    fix: copy.fix,
    steps: copy.steps,
  });
  if (r.problems.length) return { ok: false, reasons: r.problems };

  // Facts in the first email true only of this business: the gap, its ads'
  // platform and age or quote, and the shape of its site's fix.
  const personal = 2 + (quote || ctx.meta?.started ? 1 : 0);
  const common = {
    template_version: input.template_version,
    personal_count: personal,
    personal_backed: personal,
    status: "awaiting_confirmation" as const,
    needs_approval: ctx.lane.approval_required,
    lane_id: ctx.lane.id,
    address_kind: ctx.contact.address_kind,
    mx_provider: ctx.contact.mx_provider,
  };
  const first: MessageDraft = {
    ...common,
    kind: "first",
    ...r.first,
    fault: copy.lead,
    slots: {
      give_first: "yes",
      finding: copy.finding,
      fix: copy.fix,
      short_name: (input.short_name ?? "").trim(),
      lead_word: leadWord,
      ad_quote: quote?.text ?? null,
      claimed: copy.claimed.join(","),
    },
  };
  const followUp: MessageDraft = { ...common, kind: "follow_up", ...r.followUp, fault: copy.lead, slots: { give_first: "yes", steps: copy.steps } };
  const claims: Extract<Verified, { ok: true }>["claims"] = [
    ...copy.claimed.map((fault: Fault) => ({ message: "first" as const, measurement_id: m.id, fault, slot: "finding" as const, quote: copy.finding })),
    { message: "follow_up" as const, measurement_id: m.id, fault: copy.lead, slot: "second_finding" as const, quote: copy.steps },
  ];
  return { ok: true, first, followUp, claims };
}
