/**
 * Template 2, "ads": the first email Draper sends from 23 November 2026
 * (docs/DRAPER-PLAN-2.md). Kyle chose to rewrite the email around the
 * business's ad money: every business it reaches has live ads, shown by
 * Meta's Ad Library or Google's Ads Transparency Centre, and the email is
 * about one measured fault on the website those ads send people to.
 *
 * What changed from template 1, and why:
 *  - The subject is "your Google ads", not "your canopy page": true, short,
 *    no fault in it, and not the slow-website genre every agency sends.
 *  - No "we were looking at 4WD shops around the Sunshine Coast on Tuesday":
 *    that tells them they're one of a batch. The lint refuses [[day]] and
 *    [[area]] in the first email.
 *  - No "probably paid clicks" guessed from a tag: the ads are checked live.
 *    The libraries prove the ads point at their domain, not which page they
 *    land on, so the email says "send people to your website" and names a page
 *    only where Pulse measured the fault.
 *  - One line of proof from /work (the wellness franchise's cost per enquiry
 *    fell from $27.17 to $23.33, with no figure in the email), a named offer
 *    with a time promise (Kyle's: written review within two working days), and
 *    the website's address in the signature so a wary owner can check us
 *    without clicking anything.
 *  - One fault is enough. The follow-up only goes when a second fault is on
 *    record, because a follow-up with nothing new is a nudge.
 *
 * The opt-out lines are template 1's, unchanged. Installed by the advisor's
 * outreach_set_template, which inserts it as the next version and moves the
 * chosen lanes onto it.
 */
import type { TemplateText } from "./render.ts";

export const TEMPLATE_ADS: TemplateText & { slot_rules: string; example: string; note: string } = {
  first_subject: "your {ad_platform} ads",
  first_body: `Hi {first_name_or_there},

{finding}

{why_and_fix}

For a national wellness franchise, our Meta ads brought down what each enquiry cost.

{review_line}

If this isn't relevant, just reply and say so, and we won't email again.

Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078
hartwelldigital.com`,
  followup_subject: "Re: {subject}",
  followup_body: `Hi {first_name_or_there},

One more from the same look at your website. {second_finding}

The free ads review still stands: reply yes and it's with you within two working days.

{opt_out_line}

Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078
hartwelldigital.com`,
  opt_out_a: "If this isn't relevant, just reply and say so, and we won't email again.",
  opt_out_b: `If it's not for you, one word back is a real help: "sorted" if someone already looks after your ads, "later" if the timing's off, or "no thanks" and we won't email again.`,
  slot_rules: `The wording is Kyle's. You write only the three slots; Pulse fills every {placeholder} and [[token]].

Every business in this template has live ads, from the ad-library checks you recorded with outreach_record_ads. The libraries prove their ads point at their website, not which page the ads land on, so say "send people to your website" and name a page only where Pulse measured the fault.

{finding}: two sentences, 35 words at most. Starts "Your [[ad_platform]] ads send people to your website". Then the one fault Pulse measured, on the page it measured (named with [[page]]), with its token. It must be the best-ranked fault on record: outreach_ads_queue and outreach_measure list them best first. A load time always says it was Google's own speed test: "In Google's own speed test, your [[page]] page took [[largest_paint]] to show its main content on a phone."
page_name: the page as its menu names it, or its natural name in the words of its address ("4WD suspension lifts and airbags" for /4wd-suspension-lifts-airbags/), never the address squashed into words. Pulse writes it the way the site's menu does.
{why_and_fix}: two sentences, 30 words at most. What the fault does to the people their ads send, or for a tracking fault, to the numbers they judge their ads by. Say once that these are paid clicks or paid ads. Then the fix, plainly.
{second_finding}: leave it empty when only one fault is on record; then there's no follow-up. Otherwise one or two sentences, 40 words at most: a different fault, with its token and what it does. Nothing about their ads. If it was measured on a different page from the first email's, name that page in words ("your home page"); "the page" would read as the first email's.
personal_count: 2 or more.

Never, in any slot: how, when or where we found them ([[day]] and [[area]] are refused in the first email), praise, a question, "now" or "currently", "mobile" (say "on a phone"), jargon (SEO, ROI, conversion rate, LCP), "some issues", "quick fix", promises, who should fix it, what they spend, a link, a figure you typed, a dash or an exclamation mark.`,
  example: `Subject: your Facebook ads

Hi Sam,

Your Facebook ads send people to your website, and on your van builds page the Meta Pixel counts each visit twice.

So the numbers you judge those paid ads by start out wrong. Removing the second copy of the Pixel fixes it.

For a national wellness franchise, our Meta ads brought down what each enquiry cost.

We noticed another thing too. Reply yes for a free ads review covering both, emailed within two working days, no call needed.

If this isn't relevant, just reply and say so, and we won't email again.

Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078
hartwelldigital.com`,
  note: "Template 2, ads (Draper plan 2, 22 November 2026): live ads from the ad libraries, one ranked fault, the /work proof line, a named offer, optional follow-up.",
};
