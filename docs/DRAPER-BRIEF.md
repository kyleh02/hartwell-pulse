# Draper brief (Kyle's original, verbatim)

Pasted by Kyle on 19 November 2026. Kept word for word as the record of what
was asked. **`docs/DRAPER.md` records what Kyle settled after this brief and
wins wherever the two disagree.**

---

Automatic outreach in Hartwell Pulse
Your steps

1. Open the Pulse Claude Code chat on Opus 5.5 and turn on plan mode. Paste everything under "The prompt". Ask for the plan before any code.
2. Read the plan. If it lists clashes with how Pulse works now, settle them, then say go. It builds in stages and tests each one.
3. When it asks, do the Google side yourself. It will give you the clicks:
   * Create one Google Cloud project.
   * Turn on the Gmail API and the PageSpeed Insights API.
   * Set up the OAuth screen as Internal.
   * Make one OAuth client and one API key.
   * Add the environment variables it names to wherever Pulse is hosted. That's the only setup. Nothing is paid, and there are no data accounts.
4. In Google Admin, check that SPF, DKIM and DMARC are set up for hartwelldigital.com.
5. In Pulse Settings, add your test inboxes (one Gmail, one Outlook). Leave test mode on and the master switch off. Under client-area exclusions, add each current client's locations and services. Import your existing defence contacts into the fingerprints: `H:\My Drive\Ventures\Ironpeak Consulting\Leads\contact-register.csv` and `Defence outreach, ready to send, 21 Oct 2026.xlsx` in the same folder. Then let the chat run the end-to-end test.
6. In claude.ai Settings > Connectors, add the new Draper connector, using the address and key the chat gives you.
7. Come back to the advisory chat and say "set up the morning run". It sets up a weekday scheduled task that says only: call `outreach_brief` and follow it. In that task's settings, turn on Automatically approve, or it will stall each morning waiting for you.
8. Run one morning in test mode and look at the Outreach page.
9. Turn test mode off and the master switch on. Set the daily slider. It starts at 5 a day and steps up every 5 sending days to your number, with a maximum of 25. Anything past 12 a day lands in "Check these" for you to read and tick.

The prompt
You're adding automatic outreach to Hartwell Pulse (portal.hartwelldigital.com). Read the codebase first and fit what's already there: auth, the Supabase schema, the existing MCP server, the pipeline and how site enquiries arrive. Before writing code, give me a plan and list anything here that clashes with how Pulse works now.
Name: the system is called Draper. Use the name in the page title, the menu and the connector name. Keep table and tool names functional (`outreach_*`). The name never appears in any email.
Build it as its own module inside Pulse, not a fork:

* its own tables;
* admin-only pages;
* its own MCP endpoint and key;
* a feature flag.

Work on a branch with a preview deploy, and merge only after the end-to-end test passes. Clients who sign in to Pulse must never see any of it. Lock it with Supabase row-level security as well as route guards.
Context
Hartwell Digital runs Google Ads and Meta Ads for Australian businesses that live on enquiries. It's my business (Kyle Hartwell, sole trader, ABN 44 286 503 049).
This system finds small businesses in one niche at a time that have ad tracking on their site and measurable problems with it. It emails each one a short, specific note offering a free written review.
There's no human approval of each message. That's my decision. So the safety lives in Pulse's code, not in Claude's instructions. Caps, timing, the no-repeat rule, the do-not-contact checks, fact checking, the message lint and the auto-pause rules all run in code. A bad Claude run must never be able to send more, or send worse, than these rules allow.
Who does what

* A Claude scheduled task, every weekday at 5:30am Melbourne time, finds and researches businesses with its own web search and page reading. It uses Pulse's measuring tool for the facts, writes the emails, and submits them through new MCP tools. Claude never sends anything.
* Pulse measures, checks every claim against its own measurements, queues, sends from my Google Workspace mailbox, sends one follow-up, watches for replies, and shows everything on an Outreach page.
* The pipeline only gets a business once it has replied and is interested. Site enquiries keep working exactly as now.
* I answer every reply myself. Nothing replies to a person automatically.

There are no third-party data tools. Google search results and Meta's Ad Library can't be read by a machine; both block automated access, and we never get around a block. So "has ad tracking on their site" (a Google Ads tag or a Meta Pixel) stands in for "is advertising". The faults are things measured on their own site.
Build in this order
Don't switch sending on until steps 1 to 7 are done and the end-to-end test passes.
1. Data
Use your own table names.

* Prospects, separate from leads. Business name, domain, ABN, ABN status and GST status, state and postcode, lane, source (claude_run or manual), status:
   * found
   * measured
   * dropped (with a reason)
   * queued
   * sent
   * followed_up
   * replied
   * later
   * closed
* Measurements (the proof). URL, time, PageSpeed mobile results (first contentful paint, largest contentful paint, the API's phone screenshot saved to Supabase Storage), the tags found, HTTP and HTTPS results, phone links, menu links and their status codes. Keep the raw JSON.
* Contact.
   * The address.
   * The page on their own site where it's published, the text around it, and the date seen.
   * A first name, only if one is published with that address.
   * Whether it's an owner's address or a general inbox.
* Messages.
   * Subject and body.
   * Template version and settings version.
   * The slot text Claude wrote, and each claim linked to the measurement behind it.
   * Personal count.
   * Queued and sent times, Gmail message id and thread id.
   * Status.
* Events. Sent, bounced, replied, labelled, opted out, auto-paused, and so on, each with a time.
* Suppression fingerprints. Hashes of the domain, ABN, normalised name, email and phone for every business ever contacted or ever asking not to be. These are never deleted. Add a CSV import (domain, email, business name) for contact lists kept elsewhere.
* Exclusions. A private list of businesses and categories to skip. The MCP can only get a yes or no from it.
* Settings, templates and run instructions. All versioned. Every send records the versions in force when it went.
* Learning. A test register, a change log and a lessons text.

2. The no-repeat rule

* One business gets one approach, ever: a first email and at most one follow-up. After that, never again unless they write to us first.
* Check when a prospect is created, at submit, and again just before sending. Match on domain, ABN, normalised name, email and phone against:
   * the fingerprints;
   * the pipeline (leads and clients);
   * do-not-contact;
   * exclusions;
   * other prospects.
* Widen do-not-contact to work by email, domain, business and ABN. A "no" from one address covers the whole business.
* Delete a non-replier's details after 12 months and keep only the fingerprint.
* If a day turns up fewer businesses than the cap, send fewer. Zero is fine.

3. The measuring tool
This is Pulse code, called by Claude through MCP and called again by Pulse before sending.
`outreach_measure(url)` runs these checks and stores everything as a measurement:

* PageSpeed Insights API, mobile, using the API key.
* A plain fetch of the URL over HTTP and HTTPS.
* A check of every link in the site's main menu.
* Tags, read from the PageSpeed network requests and the page source:
   * a Google Ads tag (`AW-`);
   * a Meta Pixel ID;
   * Google Analytics 4 (`G-`);
   * the old Universal Analytics (`UA-`).
* How many Meta Pixel PageView requests fire per pixel ID during the load.
* Whether a phone number shows in the fetched HTML, and whether any `tel:` link exists.

Ad signal (needed to qualify): a Google Ads tag or a Meta Pixel is present.
Faults. Only these, and a fault only counts if it fails on two measurements at least one hour apart.

1. Slow on a phone. First contentful paint of 4 seconds or more, or largest contentful paint of 6 seconds or more. Report the lower of the two runs, rounded down.
2. Broken page. A page in their own main menu returns an error.
3. Not secure. The site doesn't load over HTTPS, or its certificate is invalid.
4. Phone number can't be tapped. A phone number shows in the fetched HTML and there's no `tel:` link on the page. Skip this one if the page builds its content with script and the number isn't in the HTML.
5. Meta Pixel counted twice. The same pixel ID fires two or more PageView requests in one load.
6. Old Google Analytics only. A `UA-` tag and no `G-` tag. Say only that it's the old version Google has switched off, so it isn't recording visits.

Never claim tracking faults that need a form to be sent. We never submit anyone's form.
A prospect needs the ad signal and at least two faults: one for the first email, one for the follow-up.
4. Submit, verify and lint
`outreach_submit` takes `prospect_id`, `subject`, the slots, `claims` (each with a `measurement_id`), `personal_count` and `template_version`.
It queues the message only if all of these pass. Otherwise it returns the reasons.

* The prospect passes step 2.
* Each claim matches its stored measurement. Every number, day, page name and suburb in the slots matches a stored value.
* The contact address appears on the stated page of their own site. Re-fetch the page to check.
* The lint in "Template" passes.

5. Sender and safety

* Gmail API from my Workspace mailbox. An Internal OAuth app with only the scopes needed to send, read sent threads and see replies. Tokens go in the host's environment, never in the repo.
* Never use Resend for this. Its terms ban it, and client forms depend on it.
* Message format: plain text only. No links, no attachments, no open tracking, no pixels. From name "Kyle Hartwell".
* Send window: weekdays from 9:30am to 3:30pm Melbourne time, with 20 to 45 minutes chosen at random between sends. Skip public holidays in Victoria and in the recipient's state. Skip the pause dates (default 18 December 2026 to 11 January 2027).
* Daily amount: a slider in Settings sets how many first emails go out each weekday, from 1 to 25.
* Ramp: while the mailbox warms up, the real cap is the lower of the slider and the ramp step. That's 5 a day for the first 5 sending days, then 10, 15 and 20, rising every 5 sending days. After that the slider decides.
* Hard ceilings in code, which Settings can't raise: 25 first emails a day, and 50 sends a day including follow-ups. If the follow-ups due would push a day past 50, new first emails give way to them.
* Past 12 a day, Kyle checks them himself:
   * From the 13th first email of the day onward, messages are flagged "Check these" and scheduled after the first 12, from 12:30pm. That gives me the morning to read them.
   * They still send on schedule. There's no approval gate.
   * Each one has a "Checked" tick I can mark after reading.
   * The Outreach page and the Monday numbers show how many sent checked and how many sent unchecked.
* Stop window: the day's queue is fixed by 8am. Send me a summary (business, subject, a link) using Pulse's existing notifications. The first send waits for the stop window (default 90 minutes; zero means it doesn't wait). There's a "Don't send" button per message and a pause-all switch.
* Before each send: re-run step 2's matching and re-measure the fault in that email. If it no longer fails, drop the message.
* Follow-up: day 7, in the same thread (set In-Reply-To and References), subject "Re: " plus the original subject. Re-measure its fault that morning. Cancel it on any reply, bounce or opt-out.
* Master switch: off by default. Test mode sends everything to my test inboxes.
* Lanes with approval switched on hold each queued message until I tap Approve on the Outreach page. Unapproved messages are never sent, and they expire after 3 days.
* Auto-pause (stop all sending and alert me):
   * any reply labelled complaint;
   * more than 1 in 20 "no thanks" over the last 40 first emails;
   * bounces over 5% of the last 40;
   * 100 first emails with nobody interested.
   * Two "wrong fact" labels switch that fault off until I switch it back on.

6. Replies

* Check the sent threads every 10 to 15 minutes.
* Any reply cancels the follow-up at once and notifies me.
* Opt-outs: a reply containing "no thanks", "unsubscribe", "remove", "stop" or similar is suppressed straight away, in code.
* Bounces mark the address bad. Out-of-office replies are ignored.
* Other replies wait as "needs label". I can tap a label on the Outreach page, or the next morning run labels them. The labels are interested, question, later (with a date), sorted, no thanks, wrong fact, complaint, other. Keep their words quoted.
   * Interested or question: create a lead in the existing pipeline. Source is "outreach email", the thread and proof are linked in the notes, and the follow-up is due today.
   * Later: a card returns to the Outreach page on that date.
   * Everything else: closed and suppressed.

7. MCP tools for the morning run
Put these on a separate MCP endpoint and key, so it can be added to claude.ai as its own connector. The existing connector stays as it is. This key can't send, delete, move or win leads, or see clients, invoices or the exclusions list.

* `outreach_brief()`: today's target (what the queue needs to fill the next sending day's cap), the active lane, the run instructions, the template, the lessons text and the active test.
* `outreach_check_business(domain, name, abn?, email?)`: allowed or blocked. No reason is given when it's the exclusions list.
* `outreach_add_prospect(...)` and `outreach_measure(url)`
* `outreach_submit(...)` and `outreach_drop(prospect_id, reason)`
* `outreach_replies_to_label()` and `outreach_label_reply(prospect_id, label, quote, later_date?)`
* `outreach_numbers(from, to)`

A second key, with write access to the lessons, the test register and the run instructions, is for the advisory chat. It's used only after I say yes.
8. Pages
These have to work on my phone.

* Outreach. Today's queue with send times and the "Don't send" buttons, a "Check these" group for anything past 12 with its "Checked" ticks, then sent, following up, needs label, replied, later and closed. The pause-all switch sits at the top.
* Prospect card. Measurements and screenshots, the contact proof, both messages as sent, the thread and the events.
* Settings.
   * Master switch, test mode and test inboxes.
   * Lanes: services, areas, skip list, template version and an approval switch for each, with one active at a time.
   * Client-area exclusions: each current client's locations, services and a radius (default 15 km). Prospects offering overlapping services inside the radius are skipped.
   * The daily slider (1 to 25 first emails), the send window, the stop window and the pause dates.
   * The template, the run instructions and the exclusion categories, all versioned.
* Lists. Do-not-contact, and exclusions (editable by me only).
* Numbers. Weekly counts by lane and fault: found, measured, dropped (by reason), queued, sent, bounced, replied, each label, leads, won. Under 30 sends in a group, show the count and no rate.

9. Learning records
Every send stores: lane, fault, address type, the address's mail provider (from its MX record), template version, subject, day and time, personal count, and whether it was past 12 and marked checked.
Every reply stores its label and quote. The test register holds one live test at a time: the question, versions A and B, the start date, the count that ends it, and the result. The change log records what changed, when and why.
Lanes
Store each lane in Settings with its services, areas, skip list, template version and approval switch (off unless stated). Only one lane is active at a time.

1. 4WD, caravan and camper fit-outs. Active at launch.
   * Services: canopy and drawer builders, ute trays, 12-volt and dual-battery fit-outs, suspension, caravan and camper repairs, van and campervan conversions, and small camper trailer and off-road caravan builders.
   * Areas: the Sunshine Coast (Caloundra, Kawana, Kunda Park, Maroochydore, Nambour, Noosaville) and Melbourne's industrial suburbs (Campbellfield, Thomastown, Derrimut, Laverton North, Hoppers Crossing, Dandenong, Carrum Downs, Bayswater).
   * Skip: national chains and their stores (for example TJM, ARB, Opposite Lock, Ironman 4x4), dealerships, and national manufacturers.
2. Wedding and event hire. Next, from about February.
   * Services: marquee and tent hire, furniture and styling hire, photo booths, dance floor and lighting hire, bridal boutiques.
   * Areas: the Sunshine Coast and Noosa; Melbourne, the Yarra Valley and the Mornington Peninsula.
   * Skip: venues, hotels and party supply chains.
3. Wellness studios.
   * Services: reformer pilates and yoga studios, sauna and recovery studios, float centres, massage, martial arts and boxing gyms.
   * Areas: the Sunshine Coast and Melbourne.
   * Skip:
      * anything caught by the client-area exclusions;
      * health practitioners registered with AHPRA (physio, chiro, psychology, dental and the like);
      * medical or cosmetic treatments (IV therapy, injectables, cosmetic clinics);
      * skin, beauty and facial clinics;
      * gym chains and studio franchises.
4. Defence industry. Approval switched on by default.
   * Services: Australian defence suppliers with an ad signal: manufacturers, engineering and technology firms, and other businesses in the defence supply chain.
   * Areas: Victoria and Queensland.
   * Skip:
      * DISP compliance consultants and tender writers (they compete with a client and with Ironpeak);
      * primes and foreign-owned groups;
      * anything in the imported defence lists.
   * Template: the same, with these changes:
      * `{why_and_fix}` speaks to buyers at primes and in Defence looking them up, not to consumers.
      * Never describe our checks as testing or scanning their systems. Quoting Google's speed test, or the browser's own "Not secure" warning, is fine.
5. Reserves, not active: horse float builders and repairers; swim spa and hot tub retailers.

Never, in any lane:

* trades (electricians, plumbers, builders, landscapers and the like);
* cleaning businesses;
* cyber security businesses;
* franchises and national chains;
* marketing agencies;
* directories.

Run instructions (store as version 1, returned by `outreach_brief`)

1. Call `outreach_brief`. Work only in the active lane. Stop when today's target is met, or after reading 8 sites for each email the target still needs (never more than 200 sites), whichever comes first.
2. Find businesses with web search: the lane's services plus each suburb. Skip anything in the lane's skip list or the "never" list, and any result that isn't the business's own site.
3. Check each one with `outreach_check_business`. If it's blocked, move on.
4. Read their own site.
   * Confirm they do the lane's work in the area.
   * Note their main services.
   * Find a published email on their own site. Never guess an address or build one from a pattern, and never take one from a directory or a finder tool. Skip the address if a "no marketing" or "no unsolicited email" note sits near it.
   * Prefer a named owner's address when one is published.
5. Check the ABN on the public ABN Lookup site (abr.business.gov.au). Use the ABN on their site, or their name plus state and postcode. Keep them only if the ABN is active and the match is certain.
6. Measure with `outreach_add_prospect`, then `outreach_measure` on the home page and the main service page. Keep them only if there's an ad signal and at least two faults. Otherwise call `outreach_drop` with the reason.
7. Write the slots using the template rules, then call `outreach_submit`. If it's refused, fix it once. If it's refused again, drop it.
8. Label replies: call `outreach_replies_to_label`, then `outreach_label_reply` for each.
9. Finish with a two-line summary: read, kept, submitted, dropped by reason.

Template (version 1)
The wording is mine. Claude fills only the {slots}.
First email

```
Subject: your {page_name} page

Hi {first_name or "there"},

{finding}

{why_and_fix}

We run Google and Meta ads at Hartwell Digital. We noticed {"another thing" if one more fault is on record, "a couple of other things" if two or more} while we were there, and we're happy to write {"it" or "them"} up and email {"it" or "them"} over if that's useful.

If this isn't relevant, just reply and say so, and we won't email again.

Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078
```

Follow-up, day 7

```
Hi {first_name or "there"},

One last thing we noticed, in case it's useful. {second_finding}

The offer's still there if you'd like the rest written up.

{opt_out_line}

Kyle Hartwell
Hartwell Digital, ABN 44 286 503 049
0494 791 078
```

`opt_out_line` is a setting.

* A (the default): "If this isn't relevant, just reply and say so, and we won't email again."
* B: "If it's not for you, one word back is a real help: "sorted" if someone already looks after your ads, "later" if the timing's off, or "no thanks" and we won't email again."

A reference example (a made-up business):

```
Subject: your canopy page

Hi Sam,

We were looking at 4WD fit-out shops around the Sunshine Coast on Tuesday and had a look at your site. On a phone, your canopy page took a little over six seconds to show anything on Google's own speed test.

Your site has Google's ad tracking on it, so some of those visits are probably paid clicks. Plenty of people on a phone won't wait that long, so it'd be worth getting that page loading faster before putting more into ads.
```

Slot rules

* `{finding}`: two sentences at most. What we looked at, the day, and the fault.
* `{why_and_fix}`: two sentences at most. Why it matters to their customers, and the fix. It may mention the ad signal, as a likelihood ("probably"), never as a fact about their spend.
* `{second_finding}`: one or two sentences. The second fault, re-measured that morning.

Lint, in code. Reject the draft if any of these fail:

* The fixed text is unchanged, the opt-out line and signature are present, and the "another thing" or "a couple of other things" wording matches the faults on record.
* Every figure, day, page name and suburb matches a stored measurement or prospect field.
* No em dashes, en dashes or exclamation marks.
* None of these words: honestly, genuinely, straightforward, plain English.
* No "I".
* No links.
* No prices, fees or percentages about Hartwell.
* No call or meeting ask.
* No mention of any agency, or of whoever runs their ads or their site.
* No description of our team.
* No promise of results.
* No health or treatment claims.
* Each slot is 60 words or fewer.
* Australian spelling.
* `personal_count` (sentences true only of this business) is 2 or more.

Out of scope
Anything that drives Google search, Meta's Ad Library, LinkedIn, Facebook or Instagram messages. Letters. Invoicing (it comes later, with the same pattern: Claude drafts, I press send). Any automatic reply to a person.
End-to-end test, in test mode

1. A Claude session using the new connector creates prospects, measures them, and submits drafts.
2. A business in the pipeline, on do-not-contact, in the exclusions, or contacted before is blocked.
3. A draft with a dash, a link, a wrong figure, a claim with no measurement behind it, or a missing opt-out line is refused.
4. A good draft queues. The 8am summary arrives. "Don't send" and the pause-all switch work.
5. The email arrives as plain text from my mailbox, inside the window, with the right spacing.
6. A fault fixed before sending causes a drop.
7. The day-7 follow-up threads correctly, and a reply cancels it.
8. "No thanks" suppresses the business at once. "Interested" creates a pipeline lead with source "outreach email".
9. The auto-pause rules fire on test data. The slider can't go past 25. The ceilings can't be raised. Messages past 12 land in "Check these", send after 12:30pm and can be ticked.

Then give me:

* the Google Cloud and Google Admin steps;
* the exact environment variable names;
* the connector address and key;
* what you couldn't test.
