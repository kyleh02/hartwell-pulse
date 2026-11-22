/**
 * Stage 4's test: every refusal case in the brief's end-to-end test 3 (a dash,
 * a link, a wrong figure, a claim with no measurement behind it, a missing
 * opt-out line), the rest of the rules, and a good draft passing. The template
 * is read from migration 0062 itself, so this tests Kyle's real wording.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifySubmission, type SubmitContext, type SubmitInput, type MeasurementRow } from "./verify.ts";

const sql = readFileSync(new URL("../../../supabase/migrations/0062_draper.sql", import.meta.url), "utf8").replace(/\r/g, "");
const blocks = [...sql.matchAll(/\$t\$([\s\S]*?)\$t\$/g)].map((m) => m[1]);
const TEMPLATE = {
  version: 1,
  first_subject: "your {page_name} page",
  first_body: blocks[0],
  followup_subject: "Re: {subject}",
  followup_body: blocks[1],
  opt_out_a: blocks[2],
  opt_out_b: blocks[3],
};

const m1: MeasurementRow = {
  id: "m1",
  prospect_id: "p1",
  url: "https://catten.com.au/canopies/",
  status: "ok",
  measured_at: "2026-11-17T22:00:00Z", // 9am Wednesday in Melbourne
  psi_fcp_ms: 6400,
  psi_lcp_ms: 5200,
  menu_links: [
    { url: "https://catten.com.au/canopies/", label: "Canopies", status: 200, blocked: false },
    { url: "https://catten.com.au/contact", label: "Contact", status: 404, blocked: false },
  ],
  pixel_pageviews: {},
  ad_signal: true,
  faults: ["slow_mobile", "broken_page"],
};
const m2: MeasurementRow = { ...m1, id: "m2", url: "https://catten.com.au/", faults: ["phone_not_tappable"], menu_links: [] };

const ctx = (over: Partial<SubmitContext> = {}): SubmitContext => ({
  prospect: { id: "p1", status: "measured", suburb: "Caloundra", postcode: "4551", lane_id: 1 },
  contact: { email: "sam@catten.com.au", first_name: "Sam", address_kind: "owner", mx_provider: "google" },
  lane: { id: 1, template_version: 1, approval_required: false, active: true },
  template: TEMPLATE,
  settings: { version: 1, opt_out_line: "A" },
  faultsOff: [],
  measurements: [m1, m2],
  existingMessages: 0,
  refusals: 0,
  ...over,
});

const GOOD: SubmitInput = {
  prospect_id: "p1",
  page_name: "canopy",
  area: "Sunshine Coast",
  broken_page_name: "contact",
  slots: {
    finding:
      "We were looking at 4WD fit-out shops around the [[area]] on [[day]] and had a look at your site. On a phone, your [[page]] page took [[first_paint]] to show anything on Google's own speed test.",
    why_and_fix:
      "Your site has Google's ad tracking on it, so some of those visits are probably paid clicks. Plenty of people on a phone won't wait that long, so it'd be worth getting that page loading faster before putting more into ads.",
    second_finding: "Your [[broken_page]] page, in your main menu, showed an error page when we checked it.",
  },
  claims: [
    { fault: "slow_mobile", measurement_id: "m1", slot: "finding" },
    { fault: "slow_mobile", measurement_id: "m1", slot: "why_and_fix" },
    { fault: "broken_page", measurement_id: "m1", slot: "second_finding" },
  ],
  personal_count: 3,
  template_version: 1,
};

const draft = (over: Partial<SubmitInput> = {}, slots: Partial<SubmitInput["slots"]> = {}): SubmitInput => ({
  ...GOOD,
  ...over,
  slots: { ...GOOD.slots, ...slots },
});

function refused(v: ReturnType<typeof verifySubmission>, pattern: RegExp) {
  assert.equal(v.ok, false, "expected a refusal");
  if (v.ok) return;
  assert.ok(v.reasons.some((r) => pattern.test(r)), `no reason matched ${pattern}:\n${v.reasons.join("\n")}`);
}

test("a good draft passes, rendered in Kyle's words with Pulse's figures", () => {
  const v = verifySubmission(ctx(), GOOD);
  assert.equal(v.ok, true, v.ok ? "" : v.reasons.join("\n"));
  if (!v.ok) return;
  assert.equal(v.first.subject, "your canopy page");
  assert.equal(v.followUp!.subject, "Re: your canopy page");
  assert.match(v.first.body, /^Hi Sam,\n\nWe were looking at 4WD fit-out shops around the Sunshine Coast on Wednesday/);
  assert.match(v.first.body, /your canopy page took a little over six seconds to show anything/);
  assert.match(v.first.body, /We noticed a couple of other things while we were there, and we're happy to write them up and email them over/);
  assert.match(v.first.body, /If this isn't relevant, just reply and say so, and we won't email again\.\n\nKyle Hartwell\nHartwell Digital, ABN 44 286 503 049\n0494 791 078$/);
  assert.match(v.followUp!.body, /One last thing we noticed, in case it's useful\. Your contact page, in your main menu, showed an error page/);
  assert.equal(v.first.fault, "slow_mobile");
  assert.equal(v.followUp!.fault, "broken_page");
  assert.equal(v.first.status, "awaiting_confirmation");
  assert.equal(v.first.personal_backed, 5); // area, day, page, first_paint, and the fault
  assert.equal(v.claims.length, 3);
});

test("brief test 3: a dash is refused", () => {
  refused(verifySubmission(ctx(), draft({}, { why_and_fix: "Plenty of people won't wait — so it'd be worth a look." })), /dash/);
  refused(verifySubmission(ctx(), draft({}, { why_and_fix: "Plenty of people won't wait - so it'd be worth a look." })), /dash/);
});

test("brief test 3: a link is refused", () => {
  refused(verifySubmission(ctx(), draft({}, { why_and_fix: "You can see it at www.catten.com.au/canopies on a phone." })), /link/);
  refused(verifySubmission(ctx(), draft({}, { why_and_fix: "See https://pagespeed.web.dev for the test." })), /link/);
});

test("brief test 3: a wrong figure is refused", () => {
  // Typed out rather than filled by Pulse.
  refused(verifySubmission(ctx(), draft({}, { finding: "Your [[page]] page on [[day]] took 7 seconds to show anything." })), /digit/);
  refused(verifySubmission(ctx(), draft({}, { finding: "Your [[page]] page on [[day]] took seven seconds to show anything." })), /time out/);
  refused(verifySubmission(ctx(), draft({}, { finding: "Your [[page]] page took [[first_paint]] to load on Tuesday." })), /\[\[day\]\]/);
  // A token that the measurement doesn't back: the largest paint wasn't slow.
  refused(verifySubmission(ctx(), draft({}, { finding: "On [[day]] your [[page]] page took [[largest_paint]] to finish loading." })), /largest paint wasn't slow/);
  // A page name that isn't the measured page.
  refused(verifySubmission(ctx(), draft({ page_name: "quotes" })), /page_name/);
  // A place the business isn't in.
  refused(verifySubmission(ctx(), draft({ area: "Bayswater" })), /area/);
});

test("brief test 3: a claim with no measurement behind it is refused", () => {
  refused(
    verifySubmission(ctx(), draft({ claims: [{ ...GOOD.claims[0], measurement_id: "made-up" }, GOOD.claims[1], GOOD.claims[2]] })),
    /no measurement of this business/,
  );
  // A measurement of a different business doesn't count either.
  const other = { ...m1, id: "m9", prospect_id: "p2" };
  refused(
    verifySubmission(ctx({ measurements: [m1, m2, other] }), draft({ claims: [{ ...GOOD.claims[0], measurement_id: "m9" }, GOOD.claims[1], GOOD.claims[2]] })),
    /no measurement of this business/,
  );
  // A measurement that didn't show the fault.
  refused(
    verifySubmission(ctx(), draft({ claims: [GOOD.claims[0], GOOD.claims[1], { fault: "broken_page", measurement_id: "m2", slot: "second_finding" }] })),
    /didn't show/,
  );
});

test("brief test 3: a missing opt-out line is refused", () => {
  const noOptOut = { ...TEMPLATE, first_body: TEMPLATE.first_body.replace(TEMPLATE.opt_out_a, "") };
  refused(verifySubmission(ctx({ template: noOptOut }), GOOD), /opt-out/);
});

test("the house rules in the lint", () => {
  const why = (text: string) => verifySubmission(ctx(), draft({}, { why_and_fix: text }));
  refused(why("It's honestly worth fixing that page soon."), /word Kyle doesn't use/);
  refused(why("It's worth fixing that page soon!"), /exclamation/);
  refused(why("I think it's worth fixing that page soon."), /"I"/);
  refused(why("It's worth a quick call to talk it through."), /call or a meeting/);
  refused(why("Whoever built your site may have missed it."), /agency or whoever/);
  refused(why("Our team has years of experience with this."), /team/);
  refused(why("Fixing it will increase your enquiries."), /promises results/);
  refused(why("A faster page helps anxiety and pain relief clients book."), /health/);
  refused(why("Fixing it costs very little."), /prices/);
  refused(why("You're probably wasting ad money on it."), /spend/);
  refused(why("It's worth optimizing that page's colors."), /American/);
  refused(why(Array.from({ length: 61 }, () => "word").join(" ") + "."), /61 words/);
  refused(why("One. Two. Three."), /3 sentences/);
  refused(why("Fix [[made_up]] soon."), /isn't a token/);
});

test("the morning run's own numbers are held to the rules", () => {
  refused(verifySubmission(ctx(), draft({ personal_count: 1 })), /personal_count/);
  // No tokens at all: only the fault itself is backed.
  refused(
    verifySubmission(
      ctx(),
      draft({}, { finding: "Your site was slow to show anything on Google's speed test when we looked." }),
    ),
    /Fewer than two/,
  );
});

test("one business, one approach, and the other gates", () => {
  refused(verifySubmission(ctx({ existingMessages: 2 }), GOOD), /already has its emails/);
  refused(verifySubmission(ctx({ prospect: { ...ctx().prospect, status: "dropped" } }), GOOD), /dropped/);
  refused(verifySubmission(ctx({ refusals: 2 }), GOOD), /Refused twice/);
  refused(verifySubmission(ctx({ faultsOff: ["slow_mobile"] }), GOOD), /switched off/);
  refused(verifySubmission(ctx({ contact: null }), GOOD), /contact address/);
  refused(verifySubmission(ctx({ lane: { id: 1, template_version: 2, approval_required: false, active: true } }), GOOD), /template version 2/);
  refused(verifySubmission(ctx({ measurements: [{ ...m1, ad_signal: false }, { ...m2, ad_signal: false }] }), GOOD), /ad signal/);
  refused(
    verifySubmission(ctx(), draft({ claims: [GOOD.claims[0], GOOD.claims[1], { fault: "slow_mobile", measurement_id: "m1", slot: "second_finding" }] })),
    /two different faults/,
  );
  refused(verifySubmission(ctx(), draft({ subject: "Quick question" })), /subject is fixed/);
});

test("one other fault on record says another thing, and it", () => {
  const v = verifySubmission(ctx({ measurements: [m1] }), GOOD);
  assert.equal(v.ok, true, v.ok ? "" : v.reasons.join("\n"));
  if (v.ok) assert.match(v.first.body, /We noticed another thing while we were there, and we're happy to write it up and email it over/);
});

test("option B's opt-out line goes in the follow-up", () => {
  const v = verifySubmission(ctx({ settings: { version: 2, opt_out_line: "B" } }), GOOD);
  assert.equal(v.ok, true, v.ok ? "" : v.reasons.join("\n"));
  if (v.ok) assert.ok(v.followUp!.body.includes(TEMPLATE.opt_out_b));
});
