/**
 * Template 4, "give first": the emails Draper sends from 28 November 2026
 * (Kyle, 27 November; the paper test is "Draper paper test, 27 Nov 2026.md"
 * in Drive, and the rules are in give-first.ts).
 *
 * What changed from the ads template, and why:
 *  - Only ad money nobody can measure leads an email: a Pixel or Google tag
 *    missing on a platform their ads run on. Speed and layout faults never
 *    lead one again (the Hutch Campers reply to a plain-text phone number).
 *  - The subject is a question about their own customers, with their name:
 *    "can Facebook see Coastal Tint Co's quotes?". A statement ("Facebook can't
 *    see...") would be untrue for a business whose Facebook quote forms count
 *    leads inside Facebook, so it's asked, and the first line answers it.
 *  - The fix is in the first email, in plain words, so an owner who never
 *    replies still got something useful from us. The second email gives the
 *    exact steps for their kind of site, four days later.
 *  - No proof line: the franchise result read as irrelevant to a tint shop.
 *  - Why the review is free, and the offer asked as a friendly question,
 *    instead of "reply yes".
 *  - The first email closes on "No obligation at all", with the way
 *    to stop folded in (Kyle, 27 November: "If this isn't relevant" read as a
 *    mass email, when each one is written for that business). Reply to opt
 *    out stays in every email: the Spam Act needs it.
 *
 * Pulse writes every sentence from its own records ({finding}, {fix},
 * {steps}); the morning run only names the business and picks the word for
 * what its customers send. Installed by the advisor's outreach_set_template.
 */
import type { TemplateText } from "./render.ts";

const SIGNATURE = `Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078
hartwelldigital.com`;

export const TEMPLATE_GIVE_FIRST: TemplateText & { slot_rules: string; example: string; note: string } = {
  first_subject: "can {gap_platform} see {subject_tail}?",
  first_body: `Hi {first_name_or_there},

{finding}

{fix}

We run Google and Facebook ads for small and medium Australian businesses, and instead of a pitch we offer a free review of your ads, yours to keep either way. Would you like one? Let us know and it'll be with you within two working days.

No obligation at all. Just reply if you'd rather we didn't write again.

${SIGNATURE}`,
  followup_subject: "Re: {subject}",
  followup_body: `Hi {first_name_or_there},

{steps}

The free ads review still stands. If you'd like one, let us know and it'll be with you within two working days.

{opt_out_line}

${SIGNATURE}`,
  opt_out_a: "No obligation at all. Just reply if you'd rather we didn't write again.",
  opt_out_b: `If it's not for you, one word back is a real help: "sorted" if someone already looks after your ads, "later" if the timing's off, or "no thanks" and we won't email again.`,
  slot_rules: `Pulse writes every sentence of both emails from its own records: the measurement (with the site's tag manager and Shopify settings read), and the ad-library checks you recorded. You write no slots. You pass three things to outreach_submit:

short_name: the name the business goes by, as its own website or Facebook page shows it, without "Pty Ltd". It must be its name on file or a run of its words ("Black Diamond Tinting" for "Black Diamond Tinting Co."). It goes in the subject.
lead_word: what their customers send them, from their own site's buttons and forms: "quotes" (Get a quote, Request a quote), "bookings" (Book now, Book a service) or "enquiries" (Contact us, anything else). It sets the subject's word and the form the fix names.
ad_quote (optional): three to eight words copied exactly from the text of one of their live Facebook ads, from the Ad Library check you recorded, when a short phrase says something about the business ("Now open in our new workshop"). Plain words only: no digits, prices, emoji or end punctuation. Leave it out when nothing short and plain stands out. Then the email says how long their ads have run instead.

Who gets an email: only a business whose ads are live on a platform where its site can't measure them. Pulse decides from the faults on record:
- no_meta_pixel with live Facebook ads,
- no_google_tag with live Google ads,
- pixel_double on the home page with live Facebook ads.
Anything else, however slow or broken the site: drop it with the reason "no tracking gap". Pulse refuses the submit otherwise.
Pulse can only say a tag is missing when Google's phone test ran the page, every tag manager container was read, and no cookie consent banner can be holding tags back; otherwise the fault never appears and there's nothing to write.`,
  example: `Subject: can Facebook see Coastal Tint Co's quotes?

Hi there,

Your Facebook ads have sent people to your website since May last year, but the site has no Meta Pixel on it. So Facebook can't tell which of those clicks turned into quote requests, and can only aim your ads at people likely to click, not people likely to ask for a quote.

Here's the fix: your site already has Google's tag manager, so the Pixel can go straight in there, with one line that tells Facebook when someone sends your quote form.

We run Google and Facebook ads for small and medium Australian businesses, and instead of a pitch we offer a free review of your ads, yours to keep either way. Would you like one? Let us know and it'll be with you within two working days.

No obligation at all. Just reply if you'd rather we didn't write again.

${SIGNATURE}`,
  note: "Template 4, give first (27 November 2026): tracking gaps only, the fix in the first email, the steps in the second, the review offered with why it's free. Closes on no obligation instead of \"If this isn't relevant\" (27 November).",
};
