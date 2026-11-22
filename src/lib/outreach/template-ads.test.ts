/**
 * Template 2, "ads" (Draper plan 2, 22 November 2026): the template Kyle chose
 * the night he asked for the email to be rewritten around ad money, tested as
 * it will be installed (template-ads.ts) through the same verifySubmission()
 * the connector uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifySubmission, type MeasurementRow, type SubmitContext, type SubmitInput } from "./verify.ts";
import { renderMessages, reviewLine, isAdsTemplate } from "./render.ts";
import { TEMPLATE_ADS } from "./template-ads.ts";
import { bestFault, FAULT_RANK, FAULTS } from "./rules.ts";

const T = { ...TEMPLATE_ADS, version: 2 };

const vans: MeasurementRow = {
  id: "m1",
  prospect_id: "p1",
  url: "https://vanbuilds.com.au/van-builds/",
  status: "ok",
  measured_at: "2026-11-22T20:00:00Z",
  psi_fcp_ms: 6400,
  psi_lcp_ms: 7100,
  menu_links: [{ url: "https://vanbuilds.com.au/van-builds/", label: "Van builds", status: 200, blocked: false }],
  pixel_pageviews: { "123456789": 2 },
  ad_signal: true,
  faults: ["pixel_double", "slow_mobile"],
};
const home: MeasurementRow = { ...vans, id: "m2", url: "https://vanbuilds.com.au/", faults: ["phone_not_tappable"], pixel_pageviews: {}, menu_links: [] };

const ctx = (over: Partial<SubmitContext> = {}): SubmitContext => ({
  prospect: { id: "p1", status: "measured", suburb: "Kunda Park", postcode: "4556", lane_id: 1 },
  contact: { email: "sam@vanbuilds.com.au", first_name: "Sam", address_kind: "owner", mx_provider: "google" },
  lane: { id: 1, template_version: 2, approval_required: false, active: true },
  template: T,
  settings: { version: 1, opt_out_line: "B" },
  faultsOff: [],
  measurements: [vans, home],
  existingMessages: 0,
  refusals: 0,
  ads: { platforms: ["meta"], checkedAt: "2026-11-22T21:00:00Z" },
  gstRegistered: true,
  ...over,
});

const GOOD: SubmitInput = {
  prospect_id: "p1",
  page_name: "van builds",
  slots: {
    finding: "Your [[ad_platform]] ads send people to your website, and on your [[page]] page the Meta Pixel counts each visit [[pageviews]].",
    why_and_fix: "So the numbers you judge those paid ads by start out wrong. Removing the second copy of the Pixel fixes it.",
    second_finding: "",
  },
  claims: [{ fault: "pixel_double", measurement_id: "m1", slot: "finding" }],
  personal_count: 2,
  template_version: 2,
};
const draft = (over: Partial<SubmitInput> = {}, slots: Partial<SubmitInput["slots"]> = {}): SubmitInput => ({ ...GOOD, ...over, slots: { ...GOOD.slots, ...slots } });

function refused(v: ReturnType<typeof verifySubmission>, pattern: RegExp) {
  assert.equal(v.ok, false, "expected a refusal");
  if (v.ok) return;
  assert.ok(v.reasons.some((r) => pattern.test(r)), `no reason matched ${pattern}:\n${v.reasons.join("\n")}`);
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

test("the ads template is recognised, and every fault has a rank", () => {
  assert.equal(isAdsTemplate(T), true);
  assert.deepEqual([...FAULT_RANK].sort(), [...FAULTS].sort());
  assert.equal(bestFault(["slow_mobile", "old_analytics", "pixel_double"]), "pixel_double");
  assert.equal(bestFault(["layout_shift", "slow_mobile"]), "slow_mobile");
});

test("a good draft with one fault: one email, no follow-up, in Kyle's words", () => {
  const v = verifySubmission(ctx(), GOOD);
  assert.equal(v.ok, true, v.ok ? "" : v.reasons.join("\n"));
  if (!v.ok) return;
  assert.equal(v.first.subject, "your Facebook ads");
  assert.equal(v.followUp, null);
  assert.equal(v.claims.length, 1);
  assert.equal(
    v.first.body,
    [
      "Hi Sam,",
      "",
      "Your Facebook ads send people to your website, and on your van builds page the Meta Pixel counts each visit twice.",
      "",
      "So the numbers you judge those paid ads by start out wrong. Removing the second copy of the Pixel fixes it.",
      "",
      "For a national wellness franchise, our Meta ads brought down what each enquiry cost.",
      "",
      "We noticed a couple of other things too. Reply yes for a free ads review covering the lot, emailed within two working days, no call needed.",
      "",
      "If this isn't relevant, just reply and say so, and we won't email again.",
      "",
      "Kyle Hartwell",
      "Hartwell Digital, ABN 44 286 503 049",
      "0494 791 078",
      "hartwelldigital.com",
    ].join("\n"),
  );
  // Short: greeting to opt-out line, about a hundred words.
  const upToOptOut = v.first.body.slice(0, v.first.body.indexOf("Kyle Hartwell"));
  assert.ok(words(upToOptOut) <= 110, `${words(upToOptOut)} words`);
  assert.equal(v.first.personal_backed, 4); // ad_platform, page, pageviews, and the fault
});

test("a second fault brings the follow-up, in the same thread, with nothing about their ads", () => {
  const v = verifySubmission(
    ctx(),
    draft(
      { claims: [...GOOD.claims, { fault: "phone_not_tappable", measurement_id: "m2", slot: "second_finding" }] },
      { second_finding: "The phone number on your home page can't be tapped to ring, so people on a phone have to copy it out by hand." },
    ),
  );
  assert.equal(v.ok, true, v.ok ? "" : v.reasons.join("\n"));
  if (!v.ok || !v.followUp) return assert.fail("expected a follow-up");
  assert.equal(v.followUp.subject, "Re: your Facebook ads");
  assert.equal(v.followUp.fault, "phone_not_tappable");
  assert.match(v.followUp.body, /^Hi Sam,\n\nOne more from the same look at your website\. The phone number on your home page can't be tapped/);
  assert.match(v.followUp.body, /The free ads review still stands: reply yes and it's with you within two working days\./);
  assert.ok(v.followUp.body.includes(TEMPLATE_ADS.opt_out_b));
  // Its own ad facts are refused.
  refused(
    verifySubmission(
      ctx(),
      draft(
        { claims: [...GOOD.claims, { fault: "phone_not_tappable", measurement_id: "m2", slot: "second_finding" }] },
        { second_finding: "Your [[ad_platform]] ads also land on a home page whose phone number can't be tapped." },
      ),
    ),
    /mentions their ads/,
  );
});

test("no live ads, or no GST, and it's refused", () => {
  refused(verifySubmission(ctx({ ads: { platforms: [], checkedAt: null } }), GOOD), /no live ads/);
  refused(verifySubmission(ctx({ ads: null }), GOOD), /no live ads/);
  refused(verifySubmission(ctx({ gstRegistered: false }), GOOD), /GST/);
  refused(verifySubmission(ctx({ gstRegistered: null }), GOOD), /GST/);
  // A tag on the site is no longer the test: live ads with no tag still pass.
  const v = verifySubmission(ctx({ measurements: [{ ...vans, ad_signal: false }, { ...home, ad_signal: false }] }), GOOD);
  assert.equal(v.ok, true, v.ok ? "" : v.reasons.join("\n"));
});

test("Google and Facebook both live", () => {
  const v = verifySubmission(ctx({ ads: { platforms: ["google", "meta"], checkedAt: "2026-11-22T21:00:00Z" } }), GOOD);
  assert.equal(v.ok, true, v.ok ? "" : v.reasons.join("\n"));
  if (v.ok) {
    assert.equal(v.first.subject, "your Google and Facebook ads");
    assert.match(v.first.body, /^Hi Sam,\n\nYour Google and Facebook ads send people to your website/);
  }
});

test("the first email leads with the best-ranked fault: tracking before speed", () => {
  refused(
    verifySubmission(
      ctx(),
      draft(
        { claims: [{ fault: "slow_mobile", measurement_id: "m1", slot: "finding" }] },
        { finding: "Your [[ad_platform]] ads send people to your website, and on a phone your [[page]] page took [[first_paint]] to show anything." },
      ),
    ),
    /best-ranked fault on record: "Meta Pixel counted twice"/,
  );
});

test("the slop checklist, refused in the ads template", () => {
  const f = (text: string) => verifySubmission(ctx(), draft({}, { finding: text }));
  const w = (text: string) => verifySubmission(ctx(), draft({}, { why_and_fix: text }));
  refused(f("Your [[ad_platform]] ads send people to your website. We were looking at your [[page]] page and the Meta Pixel counts each visit [[pageviews]]."), /one of a batch/);
  refused(f("Your [[ad_platform]] ads send people to your website, and on [[day]] your [[page]] page's Meta Pixel counted each visit [[pageviews]]."), /never says when or where/);
  refused(f("The Meta Pixel on your [[page]] page counts each visit [[pageviews]]."), /must start "Your \[\[ad_platform\]\] ads"/);
  refused(w("Did you know the numbers you judge those paid ads by start out wrong?"), /asks a question/);
  refused(w("Right now the numbers you judge those paid ads by start out wrong."), /says now/);
  refused(w("Your mobile visitors see the wrong numbers. It's a quick fix."), /jargon/);
  refused(w("Your mobile visitors see the wrong numbers. It's a quick fix."), /trivial/);
  refused(w("Love the van builds. The numbers you judge those paid ads by start out wrong."), /flatters/);
  refused(w("Your ads aren't converting because of it. Removing the second copy fixes it."), /ads account|converting/);
  refused(w("It's costing you enquiries. Removing the second copy fixes it."), /scare/);
  refused(w("Our tool scanned the page. Removing the second copy fixes it."), /watching/);
  refused(w("So your site's numbers start out wrong. Removing the second copy fixes it."), /without naming the page/);
  refused(w("Leverage the numbers you judge those paid ads by. Removing the second copy fixes it."), /word Kyle doesn't use/);
  // The old template's rules still hold: spend, dashes, links.
  refused(w("You're wasting money on those clicks. Removing the second copy fixes it."), /spend/);
  // Shorter slots than the old template.
  refused(w(Array.from({ length: 31 }, () => "word").join(" ") + "."), /31 words; 30 at most/);
});

test("the offer line counts what else is on record", () => {
  assert.match(reviewLine(0), /^Reply yes for a free ads review, emailed within two working days, no call needed\.$/);
  assert.match(reviewLine(1), /^We noticed another thing too\. Reply yes for a free ads review covering both/);
  assert.match(reviewLine(3), /^We noticed a couple of other things too\. Reply yes for a free ads review covering the lot/);
  const r = renderMessages(T, {
    pageName: "home",
    firstName: null,
    otherFaults: 0,
    optOut: "A",
    adPlatform: "Google",
    slots: { finding: "Your Google ads send people to your website.", why_and_fix: "Fix it.", second_finding: "" },
  });
  assert.deepEqual(r.problems, []);
  assert.equal(r.followUp, null);
  assert.match(r.first.body, /^Hi there,\n\n/);
  assert.match(r.first.body, /\n\nReply yes for a free ads review, emailed within two working days, no call needed\.\n\n/);
  // No live ads: the template can't be filled at all.
  assert.match(renderMessages(T, { pageName: "home", firstName: null, otherFaults: 0, optOut: "A", adPlatform: null, slots: { finding: "x", why_and_fix: "y", second_finding: "" } }).problems.join(" "), /No live ads/);
});
