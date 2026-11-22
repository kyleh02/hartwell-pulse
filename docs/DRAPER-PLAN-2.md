# Draper plan 2: write only to businesses whose ads are live

Kyle asked on 22 November 2026 for a hypercritical audit of Draper's targeting
and message, then for three agents to turn the audit into a better plan
(Meta's Ad Library and Google's Ads Transparency Centre allowed, his Claude
in Chrome allowed, LinkedIn left for later). He answered the decisions the
same night and asked for it to be built, tested and running by morning. This
file is that plan, what was built, and what is still open. DRAPER.md stays
the handover; this is the reasoning behind its 22 November entries.

## The problem, in one paragraph

Draper v1 wrote to any business with a Google Ads tag or a Meta Pixel on its
site and two measured faults, and opened with "We were looking at 4WD fit-out
shops around the Sunshine Coast on Tuesday". Three things were wrong with
that. A tag is weak evidence: tags stay on sites for years after the ads
stop, and Shopify and Tag Manager sites run ads with no tag Pulse can see (the
Ute Shop, Warana, had four live Meta ads and no tag at all). The opener told
every owner they were one of a batch, the oldest tell of agency spam. And the
faults it led with were mostly speed, which every spammer sends and which has
nothing to do with an ads agency unless the ads point at the slow page. The
result on 21 and 22 November: plenty of sites read, emails that would have
been easy to ignore.

## What the three agents found

**Evidence (tested by hand in Kyle's Chrome, five 4WD businesses).**
- Meta's Ad Library only shows what is running now, so finding ads proves a
  lot and finding none means only "not today". Searching it by the
  business's domain works well: the results are the ads whose text or link
  carries the domain, and a link ad's card shows the domain in capitals.
- Google's Transparency Centre must be searched by domain (advertisers are
  listed under legal names, often the owner's, so a name search finds the
  wrong business). It gives a count of ads and, on each ad's own page, a
  "Last shown" date. It never shows spend, keywords or landing pages.
- Neither can be read from a server. Meta returns 403 and its terms forbid
  automated collection; Google's page is a script shell with no data. A
  browser is the only route, which is why the plan splits the morning run.
- In the sample, two of five had live Meta ads from an identifiable Page and
  one of four had Google ads. Two of the three active advertisers sent their
  ads somewhere other than their website (Messenger, Marketplace). Expect
  fewer businesses to qualify, and better ones.

**Message (cold-email research, Australian law, Kyle's own site).**
- Relevance decides replies; a true fact about their live ads is the most
  relevant opener Draper has. Owners of small firms reply most.
- Short wins: under about 100 words, a three or four word subject, one
  follow-up in the same thread with something new in it.
- Ask whether they're interested, not for their time. "A quick chat" is the
  most common and least answered ask in cold email.
- The tells of agency spam: announcing the prospecting, vague problems,
  flattery, guarantees, "just following up", and a sender nobody can check.
- Spam Act: a published address only implies consent when the email is
  about the recipient's business, the sender must be named, and an opt-out
  honoured within five working days.

**Operations and red team.**
- The cloud routine has no browser; a Claude Desktop task on Kyle's computer
  does, but only while the computer is awake and the app is open.
- The ads claim must be dated in spirit (Pulse checked once) and tied to the
  business's own domain, never a name match: same-name businesses interstate,
  parent brands and agencies all pass a name match.
- Kill criteria were set before the first send (below), because at five a
  day the numbers stay small for weeks.

## Kyle's decisions (22 November 2026)

1. Meta and Google for now; LinkedIn later.
2. Check the ad libraries, per business.
3. Rewrite the email around ad money (the recommended template).
4. A size floor (GST registered) and tracking faults ranked above speed.
5. The qualifying rule follows the strategy: live ads and one strong fault;
   the follow-up only when there is a second.

He also asked for the run made earlier that night under the old approach to
be cleared. It was: 14 businesses never emailed, 5 of them with drafts that
would have sent on Monday 23 November.

## How it works now

**Two steps each morning.**

1. **5:30am, the cloud run** (routine "Draper morning run"). Finds businesses
   in the active lane, checks each against the no-repeat rule, reads its own
   site, checks the ABN (active, theirs, and registered for GST), adds it and
   measures the home page and the main service page. It never submits: it
   leaves measured businesses waiting for the ads check, about three for
   every email the next sending day still needs.
2. **7:30am, the browser step** (a Claude Desktop scheduled task on Kyle's
   computer, "Draper ads check"). For each waiting business, best first, it
   opens the two library searches Pulse built (Australia, active ads, their
   own domain), hands Pulse the page text with `outreach_record_ads`, and
   then writes and submits the ones with live ads until the target is met.
   No live ads in either library: dropped, "no live ads".

**Pulse reads the evidence itself** (`src/lib/outreach/ads-rules.ts`). It
builds the library addresses, so the filters are always right, and it reads
the text it is handed: an ad marked Active whose card shows the business's
own domain (Meta), or ads listed for the domain with one last shown in
Australia within 14 days (Google). Claude's reading is never stored as the
fact. Each check is an `outreach_events` row of kind `checked` with the page
text beside it, the permanent record, since Meta drops ads from the library
once they stop.

**Freshness.** A draft needs a check from the last 36 hours to be submitted,
48 at confirmation and 96 when it sends (a weekend). Older, and it drops.

**The gate**, in code (`verify.ts`, for the ads template):
- live ads, from a fresh check, pointing to their website;
- the ABN registered for GST (also refused when the business is added);
- the first email is about the best-ranked fault on record, in this order:
  Meta Pixel counted twice, old Google Analytics only, not secure, broken
  page, phone not tappable, slow on a phone, no phone layout, freezes, jumps
  about (`FAULT_RANK` in `rules.ts`);
- one fault is enough; a second brings the day-7 follow-up.

Everything Draper already enforced still holds: the caps and warm-up, the
hour-later confirmation, the no-repeat rule, do-not-contact, tokens for every
figure, the lint, the auto-pause, and Claude never sends.

## The email (template 2, "ads")

```
Subject: your Facebook ads

Hi Sam,

Your Facebook ads send people to your website, and on your van builds page
the Meta Pixel counts each visit twice.

So the numbers you judge those paid ads by start out wrong. Removing the
second copy of the Pixel fixes it.

For a national wellness franchise, our Meta ads brought down what each
enquiry cost.

We noticed another thing too. Reply yes for a free ads review covering both,
emailed within two working days, no call needed.

If this isn't relevant, just reply and say so, and we won't email again.

Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078
hartwelldigital.com
```

(Made up; the slots are Claude's, everything else is fixed or filled by
Pulse. The text lives in `src/lib/outreach/template-ads.ts`.)

What changed and why:
- **Subject "your Google ads"**: true, three words, no fault in it.
- **Opens with their ads**, `Your [[ad_platform]] ads send people to your
  website`. The libraries prove the ads point at their domain, not which page
  they land on, so the email names a page only where Pulse measured the fault.
- **No "we were looking at shops around the Sunshine Coast on Tuesday"**.
  The lint refuses `[[day]]` and `[[area]]` in the first email.
- **One line of proof** from /work, with no figure in it (the wellness
  franchise's cost per enquiry went from $27.17 to $23.33).
- **A named offer with a time promise**: a free ads review, emailed within
  two working days, no call. The brand direction's one offer.
- **The website in the signature**, as plain text, so a wary owner can check
  us without clicking anything.
- **The slop checklist is refused in code** (ads template only): announcing
  the prospecting, flattery, vague problems, scare words, claims about an ads
  account we can't see, jargon (including "mobile"; say "on a phone"), the
  house banned words, "quick fix", any question, sounding like surveillance,
  nudges, "now" or "currently", and "your site" without a named page. Slots
  are 35, 30 and 40 words at most.

The follow-up opens "One more from the same look at your website", adds the
second fault, and restates the offer. It never mentions their ads.

## Guardrails added for the browser step

- It only reads the two libraries. It never clicks an ad (the business pays
  for that click), never signs in, and stops at a login wall or captcha.
- At most two library searches and three ad pages per business, at about
  five businesses a day: a person's volume, not a scrape.
- **Risk Kyle has accepted by allowing his Chrome**: Meta's terms forbid
  automated collection, and his Chrome is signed in to his own Facebook,
  which probably runs the Business Manager he uses for client ads. The
  recommended fix is a separate Chrome profile for Draper with no Facebook or
  Google sign-in (both libraries are public pages; reading them signed out
  hasn't been tested yet). Not done yet: it needs Kyle.

## Measuring it, and when to stop

Counted weekly, test sends apart: sites read, waiting, ads confirmed,
submitted, sent; bounces, replies from people, interested or question, no
thanks, sorted, wrong facts (ad claims apart from site claims), complaints,
leads, reviews booked and delivered on time.

| Signal | Action |
|---|---|
| A complaint, or 3 bounces or 3 no-thanks in the last 40 | Auto-pause (already in code) |
| One wrong fact about their ads in the first month | Stop claiming ads; rethink the evidence |
| 2 bounces in 50 | Fix how addresses are found |
| 3 replies of "we don't run ads", "wrong business" or "sorted" in 50 | Change the targeting |
| 75 sends, fewer than 2 replies from people | Change the message |
| 150 first emails, no interested reply | Pause; rethink the offer and the lane |
| 300 first emails, fewer than 2 reviews booked | Stop the channel |
| Under 1 submitted a day over a week | Library-first discovery, or a new lane |

Zero replies in n sends still allows a true rate up to about 3/n, so zero in
100 proves little and zero in 150 means probably under 2%.

## Not done yet, in order

1. **A separate Chrome profile for Draper** (Kyle, ten minutes).
2. **"Ads with no tracking" as a fault**: live ads with no Pixel or Google
   Ads tag on the site is the strongest finding of all, and needs a
   migration to add the fault. Next.
3. **The landing page from Meta's "See ad details"**, so an email can say
   which page the ads land on, and a `[[since]]` token for long-running ads.
4. **The A/B test** the message agent designed (naming what the ads promote,
   or not), once there is a baseline: 60 first emails each, after about a
   month.
5. **Two new lanes** the evidence agent found with independent advertisers
   linking to their own sites: window furnishings (blinds, plantation
   shutters, awnings; about 800 active Meta ads for "plantation shutters")
   and paint protection, ceramic coating and tint studios. Kyle to confirm
   installers don't count as trades.
6. **LinkedIn**, as Kyle said, later.
7. The ABN check is still Claude's reading until the ABR GUID arrives.

## Sources

The three agents' reports, 22 November 2026, with their sources: Meta Ad
Library and its terms and API documentation; Google's Ads Transparency
Centre and its FAQ; Hunter, Instantly, Belkins, Woodpecker, Gong, Lavender
and GetResponse cold-email studies (vendor data, mostly US B2B: trust the
direction more than the numbers); ACMA and LegalVision on the Spam Act;
Claude Code's docs on routines and desktop scheduled tasks; Kyle's /work,
/audit and brand direction.
