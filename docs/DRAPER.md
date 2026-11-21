# Draper: automatic outreach (handover)

**Status, 20 November 2026: Stage 1 (data) done and verified: Kyle pasted
0062 and its probe passed 36 of 36 on the live database; merged into `main`
with `OUTREACH_ENABLED` unset (Draper hidden). Stage 2 (the no-repeat rule)
done too: Kyle pasted 0063 and its probe passed 5 of 5; merged into `main`.
The flag is ON in Vercel since 20 November (Config, Production): Draper's
page shows to admins; nothing can send. Stage 3 (the measuring tool) and the
client-area radius done: Kyle pasted 0064, its probe passed 3 of 3, merged
into `main` 20 November. PAGESPEED_API_KEY is in Vercel (Secret, 20 Nov);
ABR_GUID applied for, not yet issued. Stage 4 (submit, verify, lint) done:
no migration, merged into `main` 20 November. Stage 5 (the sender) done in
code: Kyle pasted 0065, its probe passed 4 of 4, merged into `main` 20
November. Kyle's Google and Vercel setup, Gmail and the cron job are done;
the test pair arrives clean (emails now carry a bare HTML copy, Kyle's
choice). Holiday dates: Kyle said yes, but data.gov.au refuses automated
downloads, so they are not loaded yet and nothing schedules. Stage 6
(replies, and Send on weekends) done: Kyle pasted 0066, its probe passed 6
of 6, merged into `main` 20 November. Stage 7 (the two connectors) done, no
migration, merged into `main` 20 November: Kyle adds Draper in claude.ai and
approves it on the portal; both Draper and Draper advisor are connected.
Holidays: Kyle dropped the state table on 20 November; Pulse skips only the
seven national public holidays, worked out itself, so sending days exist and
nothing waits on a download. 21 November: the first real morning run (test
mode) read 15 sites and submitted none, because most 4WD sites are only
slow and a prospect needs two faults. Kyle chose three more faults and a
deliberately broken sample workshop on the portal for a forced end-to-end
test; Kyle pasted 0067, its probe passed 3 of 3, merged into `main` 21
November. Next: the forced test (every step once, into the test inbox),
then Stage 8 pages and the daily run.**
Branch `draper` (renamed
from `draper-outreach` the same day, at Kyle's request), cut from `main` at
80fbe0b. Next step: Stage 2, the no-repeat rule.

Read this file first, then `docs/DRAPER-BRIEF.md` (Kyle's brief, word for word).
**Where the two disagree, this file wins**: it records what Kyle settled after
writing the brief. Update the status line and the stage list at the end of
every session that touches Draper, and add a dated line to the log at the
bottom, so a lost chat costs nothing.

## What it is

Draper finds small Australian businesses, one niche ("lane") at a time, that
have ad tracking on their site (a Google Ads tag or a Meta Pixel) and at least
two faults Pulse can measure on their own site. It emails each one a short
plain-text note from Kyle offering a free written review, plus one follow-up a
week later, then never again unless they write first. Claude does the finding,
reading and writing in a weekday 5:30am scheduled task and submits through its
own connector. **Claude never sends.** Pulse measures, fact checks every claim
against its own measurements, lints, queues, sends through Gmail, watches for
replies and hands interested businesses to the existing pipeline. Kyle answers
every reply himself.

There is no human approval of each message, by Kyle's decision. So **every
safety rule lives in Pulse's code**, not in Claude's instructions: caps, timing,
the no-repeat rule, do-not-contact, fact checking, the lint and the auto-pause
rules. A bad Claude run must never be able to send more, or worse, than the
code allows.

The name "Draper" appears in the page title, the menu and the connector name,
and **never in any email**. Tables and tools are `outreach_*`.

## Decisions settled on 19 November 2026

The plan raised nine clashes with how Pulse works. Kyle settled them in one
reply: 2, 3 and 4 by name, "go with the rest of your recommendations" for the
others, and he asked about the mailbox (decision 1).

1. **Sender: stay on hartwelldigital.com, from its own mailbox,
   `kyle@hartwelldigital.com`, display name "Kyle Hartwell".** It is a separate
   Workspace user, not an alias on admin@.
   - Not admin@: Resend sends every client email (invoices, welcome, reports)
     as admin@hartwelldigital.com, and client mail lands there.
   - Not an alias: Draper's Gmail access would then read all of admin@'s mail.
     Its own user keeps the connection to outreach mail only.
   - **Accepted risk, written down:** outreach still shares the domain's
     reputation with client invoices. This is how the Ironpeak Microsoft 365
     tenant was lost in August 2026. The guards are the low caps and ramp,
     plain text with no links, and the auto-pause rules. Kyle should also
     watch the domain in Google Postmaster Tools (free).
   - Cost: one more Workspace licence. A second domain was offered and
     declined.
   - **20 November 2026:** Kyle first chose an alias on admin@ to save the
     licence, then found kyle@ already existed as its own Workspace user
     (active, never signed in). An address can't be both a user and an
     alias, so he licensed that user instead. **The plan above stands as
     first written:** its own user, so Draper's Gmail connection reaches only
     outreach mail. The address is never "draper@": the name stays out of
     every email.
2. **Branch, then dark launch. No preview deploy testing.** Work happens on
   `draper`. Each stage passes the build and its own tests, then
   fast-forwards into `main` with the feature flag off. The end-to-end test
   runs on the live portal with **test mode on and the master switch off**.
   - Why: Clerk's production instance only signs in on
     portal.hartwelldigital.com, so admin pages and the connector's consent
     screen cannot open on a preview address. Previews share the one Supabase
     database anyway, and Vercel only runs crons on production.
   - This replaces the brief's "merge only after the end-to-end test passes"
     with "nothing can send until it passes". Both switches have to change, by
     Kyle's hand, before a real business can be reached.
   - **Feature flag:** `OUTREACH_ENABLED=true` in Vercel shows Draper's pages
     and menu entry to admins and lets its connector endpoints answer. Unset,
     every Draper route is a 404. Row-level security and the admin guards
     apply either way.
3. **The morning run fills the NEXT sending day's queue, and Pulse confirms
   every fault itself.**
   - The brief says a fault only counts if it fails twice at least an hour
     apart. A 5:30am run with the queue fixed by 8am leaves no room for that.
   - So `outreach_brief`'s target is the next sending day's cap less what is
     already queued for it.
   - A submitted message waits as "awaiting confirmation". Pulse's own tick
     re-measures each claimed fault 60 minutes or more after the first
     measurement. Both runs fail: the message is queued. The fault did not
     repeat: it is dropped with that reason.
   - The 8am summary, the stop window and "Don't send" then work on a day's
     queue that was confirmed the day before.
   - **Figures come from Pulse, not Claude.** Slots carry tokens that Pulse
     renders from the lower of the two runs, rounded down (for example "a
     little over six seconds"), and the weekday of the measurement. A number
     in an email can never disagree with its proof. Page names and suburbs are
     checked against stored values. Exact token syntax is decided in Stage 4.
4. **Connectors sign in with OAuth; there are no keys.** claude.ai connectors
   authenticate with OAuth, and Pulse is already its own OAuth 2.1 server for
   `/api/mcp` (`src/lib/mcp/oauth.ts`). Draper adds two resources to that
   server:
   - `https://portal.hartwelldigital.com/api/mcp/outreach`, scope `outreach`:
     the morning-run tools. Named "Draper" in claude.ai.
   - `https://portal.hartwelldigital.com/api/mcp/outreach-advisor`, scope
     `outreach-advisor`: the outreach tools, plus writes to the lessons, the
     test register and the run instructions. Named "Draper advisor". For the
     advisory chat, used only after Kyle says yes.
   - Tokens are bound to their resource by the existing audience check, so
     neither can call the other or `/api/mcp`. `/api/mcp` and its "pipeline"
     scope stay exactly as they are. The consent page names which one is being
     approved.
   - Neither can send, delete, move or win leads, or see clients, invoices or
     the exclusions list (a yes/no check only).
   - Kyle's brief step 6 ("the address and key") becomes: add the address in
     claude.ai, then approve on the portal.
5. **Gmail connects with a button, not a pasted token.** "Connect Gmail" in
   Draper's Settings runs Google's OAuth for kyle@ (an Internal app). The
   refresh token is stored encrypted (AES-GCM) in a table only the service role
   can read, under the key `OUTREACH_TOKEN_KEY` from Vercel. The client id and
   secret stay in Vercel. Disconnect revokes it. Reconnecting is a click, not a
   hand-minted token and a redeploy. Scopes: the fewest that send, read sent
   threads and see replies (expected `gmail.send` and `gmail.readonly`,
   confirmed in Stage 5).
6. **What code can and cannot check, said plainly.**
   - **ABN:** checked in code through the ABR's own web service, which needs a
     free GUID Kyle registers for (no paid account). Pulse confirms the ABN is
     active, the name matches, and the GST status, at add and at submit. Until
     the GUID is in Vercel, ABN status is Claude's word and is recorded as such.
   - **Judgement rules in the lint** (no health or treatment claims, no promise
     of results, no mention of an agency or whoever runs their ads, Australian
     spelling, no team description) are word and pattern lists in
     `src/lib/outreach/lint.ts`. They catch the obvious cases and will miss a
     rewording. The fixed template is the real limit: Claude writes three short
     slots at most.
   - **Personal count:** Claude's own number is stored, but the rule is
     enforced as "at least two claims backed by this business's own
     measurements or prospect fields".
7. **Location and holiday data are bundled, not fetched.**
   - The 15 km client-area radius uses a table of Australian postcodes and
     their locations, loaded once from a free public dataset. Record the source
     and licence in the migration. Distance is plain haversine.
   - Public holidays: a table for 2026 and 2027, every state. **Draper refuses
     to schedule a date the table does not cover**, so a missing year stops
     sending rather than sending on a holiday. Topping it up yearly is a
     November job.
   - **Replaced 20 November 2026.** data.gov.au refused the download, and
     Kyle said: "Forget the holiday dates, we will send them then too.
     Except for big ones like Christmas or New Years." So there is no table:
     `nationalHolidays()` in `schedule.ts` works out, for any year, New
     Year's Day, Australia Day, Good Friday and Easter Monday (from Easter,
     computed), Anzac Day, Christmas Day and Boxing Day, plus the weekday
     stand-in when New Year's Day, Australia Day, Christmas or Boxing Day
     lands on a weekend. Draper sends on every other day the settings
     allow, state holidays included. No year is ever "not covered". The
     pause dates (18 December to 11 January in settings v1) still apply.
8. **The defence lane is left out of this build.** Ironpeak trades in defence
   under the same ABN (44 286 503 049). A Hartwell email to a defence supplier
   carries the ABN that Ironpeak's invoices carry, so a firm that knows Ironpeak
   can connect the two, which the Ironpeak rule exists to prevent. Lanes built:
   1 (4WD, active at launch), 2 (wedding and event hire), 3 (wellness studios),
   and 5 (reserves, inactive). **Ironpeak's defence contact lists are still
   imported as fingerprints**: they only ever block, which is right regardless.
9. **The morning task's machine.** If the 5:30am task is a Claude desktop
   scheduled task, it only runs while that computer is awake with the app open.
   Kyle to confirm where it runs before relying on it (brief step 7).
10. **The signature says "Kyle Hartwell".** That is the trading persona, and the
    brand direction allows the name in email signatures. The portal rule that
    clients only see "Kyle" is untouched. Correct neither.

## How it fits Pulse

- **New tables**, all `outreach_*`, from migration **0062** on. RLS on every
  one, admin policies through `is_admin()`. Writes from server code use the
  service role only after an admin check or a valid Draper token. The
  fingerprints table has no delete path at all (no policy, and a trigger that
  refuses a delete).
- **New code:**
  - `src/lib/outreach/`: pure rules (matching and normalising, faults, lint,
    template rendering, scheduling, ramp and ceilings, auto-pause) kept free of
    I/O so they can be tested, plus the Gmail, PageSpeed and ABR clients.
  - `src/app/admin/outreach/`: Outreach, prospect card, Settings, Lists,
    Numbers. Phone first.
  - `src/app/api/mcp/outreach/` and `src/app/api/mcp/outreach-advisor/`.
  - `src/app/api/cron/outreach-tick`: confirm faults, send the next due
    message, follow-ups, the 8am summary.
  - `src/app/api/cron/outreach-replies`: read threads, opt-outs, bounces.
- **Existing pieces it extends:**
  - `do_not_contact` gains domain, ABN, normalised business name and phone, so
    a "no" from one address covers the whole business.
  - `leads.source` gains `outreach`, shown as "Outreach email". Interested and
    question replies become leads through `src/lib/pipeline-ops.ts`, the same
    functions as the pipeline's own buttons, due today.
  - `notifications.type` gains `outreach`, for the 8am summary, replies and
    auto-pause alerts.
  - The admin nav gets a Draper entry when the flag is on.
  - The 04:00 UTC purge job deletes non-repliers' details after 12 months
    (the fingerprint stays).
- **Unchanged:** site enquiries (`/api/webhooks/lead`), the existing connector,
  every Resend path. The old outreach CRM deleted on 28 October 2026 stays
  deleted; nothing of it is revived.
- **Scheduling:** Vercel Hobby runs its own crons once a day at most, so, like
  the 15-minute email job, Draper's ticks run from cron-job.org with
  `CRON_SECRET`: `outreach-tick` every 5 minutes, `outreach-replies` every 10.
  Kyle adds those jobs at Stage 5.
- **Time limits:** each function call gets 60 seconds and a PageSpeed run takes
  15 to 40, so the tick confirms or sends one message per call and leaves the
  rest for the next.
- **Measuring fails safe:** a bot-protection block page (403, 429 or a 503
  challenge) is "couldn't check", never a broken page. "We never get around a
  block." Menus built by script may be missed, which costs a fault, never
  invents one.
- **Tests:** Pulse has no test runner (`package.json` has build, lint and
  typecheck only). Stage 1 adds `npm test` with Node's built-in test runner
  for Draper's pure rules.
- **Spam Act:** the design fits the Act's conspicuously-published-address
  consent and reply-to-opt-out as read on 19 November 2026 (published address
  on their own site, no "no marketing" note near it, relevant to their
  business, sender and ABN identified, opt-outs honoured at once). Not legal
  advice.

## Build stages

Each stage is its own commit on `draper`, with its migration (Kyle
pastes it), a probe that the migration landed, and its own tests. Then it
fast-forwards into `main`.

- [x] **Stage 0: plan and handover.** This file, the brief, the CLAUDE.md
      pointer. (19 Nov 2026)
- [x] **Stage 1: data.** (Built 19 Nov 2026; 0062 pasted by Kyle and merged
      into `main` 20 Nov.) Every table, admin-only RLS, the feature flag,
      versioned settings, templates and run instructions (v1 of each from the
      brief), lanes 1, 2, 3 and 5, the `npm test` runner. Test: a client login
      reads nothing, an admin reads everything, a fingerprint cannot be deleted.
      - `supabase/migrations/0062_draper.sql`: 21 `outreach_*` tables. What
        the database itself refuses: changing or deleting a fingerprint
        (trigger, TRUNCATE too, even the service role); changing a recorded
        settings, template, run instructions or lessons version; deleting a
        message that really went out (test-mode sends can be cleared); a
        second first email or follow-up for one business (unique on
        prospect and kind); a second prospect for one domain; a slider past
        25; lane 4. `outreach_gmail` has no grants and no policies at all.
      - `supabase/probes/0062_draper_probe.sql`: Kyle pastes it after 0062.
        36 checks, every one should say pass = true; it changes nothing.
        Before shipping it ran against Postgres 16 (PGlite, with Supabase's
        roles and `auth.jwt()` stubbed): 36 of 36 passed, the migration ran
        twice cleanly, and with a fingerprint trigger dropped and a leaky
        policy added the probe failed the three checks it should.
      - `src/lib/outreach/`: `flag.ts` (`OUTREACH_ENABLED`, only "true"
        counts), `rules.ts` (every fixed list, mirrored from 0062's
        constraints), `limits.ts` (25, 50, the ramp, follow-ups first,
        "Check these" from the 13th), `types.ts`. Modules here import each
        other with a `.ts` extension so Node can run them;
        `allowImportingTsExtensions` is on in tsconfig for that.
      - `npm test` runs `src/**/*.test.ts` with Node's own runner (type
        stripping, Node 22.18 or later; this PC has 24). 15 tests:
        `limits.test.ts`, `flag.test.ts`, and `schema.test.ts`, which reads
        0062 and fails if a list in `rules.ts` drifts from its constraint.
      - The menu: `NavItem.flag = "outreach"`, filtered by `navFor()` in the
        shell and the command palette; the admin layout reads the flag.
      - `/admin/outreach` (404 with the flag off): a read-only page of the
        switches, how the flow fits Pulse, the lanes, template v1 with
        Claude's slots in gold, the run instructions and the build list.
        Reads through the RLS client. Stage 8 replaces it.
      - Template v1's slot names, settled here: Claude writes `{finding}`,
        `{why_and_fix}` and `{second_finding}`; Pulse fills `{page_name}`,
        `{first_name_or_there}`, `{other_things}`, `{it_or_them}`,
        `{opt_out_line}` and `{subject}`. The figure tokens inside Claude's
        slots are still Stage 4's; if they need words in the slot rules,
        Stage 4 adds template v2 (versions are never edited).
      - The run's "never" list is `outreach_settings.never_list` (returned
        to Claude); Kyle's private categories are `exclusion_categories`
        (never returned). Both versioned with the settings.
      - Left for later on purpose: `leads.source = 'outreach'` (Stage 6, so
        the pipeline's Add lead menu doesn't offer it early),
        `notifications.type = 'outreach'` (Stage 5), the wider
        `do_not_contact` (Stage 2), postcode and holiday data (Stages 2
        and 5).
- [x] **Stage 2: the no-repeat rule.** (Built 20 Nov 2026; 0063 pasted and
      verified, 5 of 5, and merged into `main` the same day.) Normalising and hashing, matching
      against fingerprints, leads, clients, do-not-contact, exclusions and other
      prospects; widened do-not-contact; the CSV import; then the Ironpeak lists
      (`H:\My Drive\Ventures\Ironpeak Consulting\Leads\contact-register.csv` and
      `Defence outreach, ready to send, 21 Oct 2026.xlsx`, converted by Claude).
      Test: each kind of block, including a "no" from one address blocking its
      business.
      - `normalise.ts`: one key per domain (from a website, URL or email; no
        `www.`, subdomains kept whole), email (lower case, no `+tag`, Gmail
        dots dropped), ABN (ATO check digit), business name (no case,
        punctuation, "Pty Ltd" or leading "The"; "t/a" gives both names;
        exact match only) and phone (ten digits with area code, or a 13
        number; eight digits give no key). Webmail and ISP domains
        (`FREE_MAIL_DOMAINS`) and shared hosts like facebook.com
        (`SHARED_HOSTS`) never give a domain key. **The outputs are pinned
        in `normalise.test.ts` and the hash in `fingerprint.test.ts`
        (SHA-256 of `kind:value`): changing either silently stops old
        fingerprints matching.**
      - `match.ts`: the verdict, pure. `publicVerdict()` is what a connector
        may be told: reasons without names, and no reason at all when Kyle's
        exclusions matched. No keys at all means not allowed.
      - `check.ts`: reads leads (business, email, phone, website), clients
        (name, legal name, ABN, their people's emails), do-not-contact,
        exclusions, prospects and their contacts, a page of 1,000 at a time,
        and fingerprints by hash. Fails closed: anything unreadable means not
        allowed. `recordFingerprints()` adds hashes, leaving any already on
        file. It loads every table on each check, fine at today's sizes;
        cache per run if prospects reach the tens of thousands.
      - Do-not-contact (`/admin/pipeline/do-not-contact`) takes website, ABN
        and phone as well as email, any one of email, website or business
        will do, and every entry is also written as fingerprints. 0063 adds
        the `abn` and `phone` columns (written in their own update, so the
        form works before 0063 too).
      - `POST /api/outreach/fingerprints` (admins, flag on): a CSV upload,
        or `{"from":"do_not_contact"}` to copy the whole list in. Logged in
        `outreach_change_log`.
      - The Draper page's "One approach per business, ever" card: Check a
        business (with the names behind a block, and exactly what the
        connector would be told), Import, and Copy it in.
      - The Ironpeak lists were converted to one file, kept in Kyle's Drive
        and never in the repo: `H:\My Drive\Ventures\Ironpeak Consulting\Leads\Ironpeak lists for Draper, 20 Nov 2026.csv`.
        170 rows (107 from the register, 63 from the spreadsheet's six
        sheets), 372 keys: 123 domains, 119 emails, 130 names. Kyle imports
        it on the Draper page.
      - Tests: 41 in all, including each kind of block and a no from one
        address at a business blocking a different address there.
      - **The client-area radius, added 20 Nov with Stage 3** (Kyle OK'd the
        download): `data/au-postcodes.ts` is generated from GeoNames' AU
        postal codes (CC BY 4.0, credit GeoNames; 18,566 localities averaged
        into 3,170 postcodes, 79 KB). `geo.ts`: haversine between postcodes;
        services overlap when they share a meaningful word (generic words
        like hire, studio, repairs and plurals dropped); a client area with
        no services covers every business in its radius; an unknown
        prospect postcode is blocked while any client area exists. The
        check only runs when a postcode is passed, so `outreach_add_prospect`
        (Stage 7) must require one. A match is private, like exclusions:
        the connector gets no reason. Kyle enters areas on the Draper page
        ("Your clients' areas").
- [x] **Stage 3: the measuring tool.** (Built 20 Nov 2026; 0064 pasted and
      verified 3 of 3, merged the same day; the speed test and ABN check
      wait on Kyle's keys.) PageSpeed
      mobile, HTTP and HTTPS
      fetches, menu links, the tags, Meta Pixel PageView counts, phone and
      `tel:` checks, the screenshot to storage, raw JSON, the six faults, the
      confirmation re-run. ABR check. Test: known sites, Kyle's own included.
      - `measure-rules.ts` (pure): tags from the source AND PageSpeed's
        network requests (so Tag Manager tags count), PageView counts per
        pixel, visible-text phone numbers, `tel:` links, script-built pages,
        block pages (403/429 always; otherwise a challenge marker AND an
        error or under 80 words, because normal pages carry reCAPTCHA and
        Cloudflare's background script), main-menu links (`<nav>`/`<header>`,
        else an element whose class or id says nav or menu, its own contents
        only), the six fault rules, `confirmedFaults()` (two ok runs at least
        60 minutes apart), `qualifies()` (ad signal and two faults).
      - `measure.ts`: `measureSite(url)`, never throws, about 25 to 45
        seconds. HTTPS then HTTP **one after the other** (neverssl.com drops
        a second connection while the first is open, and read as down),
        with one retry on a connection timeout; PageSpeed runs alongside;
        up to 12 menu links, six at a time, bodies not downloaded.
        `setDefaultResultOrder("ipv4first")` because fetch otherwise spends
        its connect timeout on unroutable IPv6. It identifies itself as
        `HartwellPulse/1.0` and never gets around a block.
      - `store.ts`: `storeMeasurement()` writes `outreach_measurements` and
        the screenshot to the private `outreach` bucket (0064, no storage
        policies, service role only). First used by the connector (Stage 7).
      - `abr.ts`: the ABR JSON service (JSONP), status, entity and business
        names, GST, state and postcode; the name must match exactly
        (normalised). No `ABR_GUID`: nothing fetched, "not checked by Pulse".
      - `POST /api/outreach/measure` and "Measure a site" on the Draper page:
        a measurement shown, not stored.
      - Live test, 20 Nov from Kyle's PC: hartwelldigital.com read fine, its
        phone tappable, no ad tracking, and its menu is built by script so
        none was found (correct: missed, never invented). expired.badssl.com
        was a certificate failure. neverssl.com answered differently on two
        runs, which is the case the hour-apart rule exists for. **PageSpeed
        refused every call without a key ("Queries per day" exceeded on
        Google's shared quota), so the speed test is untested until
        PAGESPEED_API_KEY is in Vercel.** The ABR check is untested until
        ABR_GUID is. Tests: 70 in all.
- [x] **Stage 4: submit, verify, lint.** (Built and merged 20 Nov 2026, no
      migration.) Template v1 rendering with Pulse-filled
      figures, claim checks, contact page re-fetch, every lint rule. Test: every
      refusal case in brief test 3, and a good draft passes.
      - **The token syntax, settled:** `[[day]]`, `[[first_paint]]`,
        `[[largest_paint]]`, `[[page]]`, `[[broken_page]]`, `[[area]]`,
        `[[pageviews]]` (`tokens.ts`). `TOKEN_GUIDE` there is what
        `outreach_brief` must return alongside the template's slot rules;
        it lives in code, so template v1 stays as it is and no v2 was needed.
        Any digit (bar trade words like 4WD, 4x4, 12-volt), weekday, month,
        time or count typed out is refused. Times are rounded down and
        worded ("a little over six seconds"). `[[first_paint]]` needs FCP of
        4 s or more on the claimed measurement, `[[largest_paint]]` LCP of
        6 s or more. `page_name` must be the measured page's address slug or
        menu label ("home" at the root), or the broken page for a
        broken-page email. `area` must be the business's own suburb or the
        region its postcode is in (`REGIONS`, rough postcode ranges), never
        another lane area.
      - `lint.ts`: every rule in the brief as word and pattern lists, on the
        slot as written with tokens blanked (so a filled page name can't trip
        a rule), length and punctuation on the slot as sent. Also refuses the
        word Draper, "me/my", talk of their spend, and unknown tokens.
      - `render.ts`: fills the template and proves every placeholder-free
        line of Kyle's text arrived unchanged, both opt-out lines included.
        "another thing / it" or "a couple of other things / them" from the
        faults on record (ok measurements, less switched-off faults, less the
        first email's own). **Stage 5 must re-render at confirmation** from
        the lower of the two runs and the confirmed faults.
      - `verify.ts` (pure): claims (one fault per email, two different
        faults, each backed by an ok measurement of this prospect that
        showed it, not switched off, the ad signal on record), tokens, lint,
        personal (Claude's count 2+, and Pulse's: each token filled plus the
        fault, 2+), template version, two refusals and it says drop.
      - `contact.ts` and `submit.ts`: the no-repeat check again, the contact
        page fetched again (own site, address present as text, mailto or
        entity-encoded, no "no marketing" note within 300 characters), then
        verify; stores both messages as `awaiting_confirmation` with their
        claims, or a `refused` event with the reasons. Called by the
        connector in Stage 7.
      - "Check wording" on the Draper page runs the lint in the browser.
      - Tests: 88 in all; `verify.test.ts` reads template v1 from 0062.
- [x] **Stage 5: sender.** (Built 20 Nov 2026; 0065 pasted and verified 4 of
      4, merged the same day; real sends wait on Kyle's setup.) Connect Gmail, the window and random gaps, holidays
      and pause dates, the slider, ramp and hard ceilings, "Check these" past
      12 from 12:30pm, the 8am summary, the stop window, "Don't send", pause
      all, the pre-send re-check, the day-7 threaded follow-up, test mode, lane
      approval. Test: clock tests on the rules, then real sends to the test
      inboxes.
      - `schedule.ts` (pure, clock-tested): Melbourne dates and times across
        daylight saving; a sending day is a weekday, not a holiday in VIC or
        the recipient's state, not in the pause dates, **and in a year the
        holiday table covers**; day 7 or the next sending day; `planDay()`
        (after the stop window from the 8am summary, or from a later fix,
        plus up to ten minutes; random gaps; Check these from 12:30; what
        won't fit by the window's close rolls over); `recipientFor()` (test
        mode sends everything to the test inboxes whatever the master switch
        says; a business only with master ON and test mode OFF).
      - **Clash with the brief, raised with Kyle 20 Nov:** 20 to 45 minutes
        between sends inside 9:30 to 3:30 fits about 11 to 18 a day, not 25
        (19 at the 20-minute floor). Built as: the plan never squeezes the
        gaps; what won't fit rolls to the next sending day. The ramp's first
        weeks (5 and 10 a day) fit comfortably. Kyle to choose later: widen
        the window, shorten the gaps, or accept roll-over.
      - `data/au-holidays.ts` is **empty until Kyle OKs downloading the
        official dates** (data.gov.au's Australian public holidays, CC BY);
        until then every day reads "no public holiday dates are loaded" and
        nothing is scheduled (decision 7: a missing year stops sending).
      - `crypto.ts`: AES-256-GCM sealing of the refresh token under
        `OUTREACH_TOKEN_KEY`. `gmail.ts`: OAuth URL (offline, consent,
        login_hint kyle@), code exchange, refresh, revoke, profile, send,
        find-by-Message-ID, and `buildMessage()` (CRLF, UTF-8,
        multipart/alternative: plain text plus the same words as bare HTML,
        both quoted-printable, since 20 Nov;
        "Kyle Hartwell" <kyle@>, our own Message-ID, In-Reply-To and
        References for the follow-up; header values can't be split).
        `gmail-access.ts` stores and reads the sealed token (service role).
      - `/api/outreach/gmail/connect` and `/callback`: state cookie checked
        in constant time; the account must be kyle@ and both scopes granted,
        else the token is revoked and nothing stored.
      - `sender.ts`, `tick()` from `/api/cron/outreach-tick` (cron-job.org,
        every 5 minutes, CRON_SECRET): one thing per call. Expire approvals
        held 3 days; at 8am on a sending day fix the queue (follow-ups due,
        then first emails oldest first, capped by the slider, the ramp from
        real sending days and the ceilings; 13th on in Check these) and send
        the summary (`notifyAdmins`, type `outreach`, instant channel);
        send the next due message (claimed queued to sending; no-repeat
        check again, ignoring only its own `prospect:<id>` fingerprints; the
        fault measured again and stored as pre_send or follow_up; fixed is
        dropped, unreadable is retried; a follow-up's figures re-filled from
        that morning; Gmail; a retry first asks Gmail for the Message-ID so
        nothing goes twice; three failures and Kyle is told); or confirm one
        draft (each claimed page measured again an hour or more after its
        first run; both faults must repeat; the first email's figures
        re-filled from the lower of the runs and "another thing" recounted
        from confirmed faults; queued for the next sending day).
      - A real first send writes fingerprints (`contacted`,
        `prospect:<id>`) and books the follow-up's day. Test sends don't
        fingerprint. **A follow-up goes wherever its first went**, and each
        business keeps to one test inbox, so a test pair threads and a
        business never gets a follow-up to a first it never received.
      - Pages: Sending (Gmail, the mode, pause all, the tick's last word,
        holiday status, "Send a test pair": the brief's reference email and
        its threaded follow-up to the first test inbox), Queue (each email
        readable; Don't send, Approve, Checked), Settings (versioned;
        going live asks first).
      - 0065: notification type `outreach`; messages `confirmed_at`,
        `send_attempts`, `send_error`; state `queue_fixed_on`, `tick_at`,
        `tick_note`. Passed on Postgres with 0062's probe still 36 of 36.
      - **Untested until Kyle's setup:** the Google sign-in, real sends,
        threading in a real inbox, the 8am email. The pure rules: 99 tests.
- [x] **Stage 6: replies.** (Built 20 Nov 2026; 0066 pasted and verified 6 of
      6, merged the same day. Live reply test waiting on Kyle.)
      Thread polling, opt-out words, bounces,
      out-of-office, labels, leads, "later" cards, every auto-pause rule. Test:
      real replies from the test inboxes.
      - `replies-rules.ts` (pure, 9 tests): reads a Gmail message; cuts their
        words from the quoted original (Gmail's "On ... wrote:", Outlook's
        separator and From/Sent block, "Sent from my iPhone", ">" lines, an
        HTML reply's gmail_quote and blockquote); sorts bounce (mailer-daemon,
        a delivery report, the usual subjects; a delay notice is ignored),
        automatic (Auto-Submitted, X-Autoreply, Precedence, "Automatic
        reply:" subjects), opt-out, or reply. **Opt-out words are matched on
        their own words only**, with our template lines and both opt-out
        lines removed wherever they were wrapped (line B contains "no
        thanks"), a "one-stop" tagline excused, and everything from a legal
        footer's first line down ignored ("if you are not the intended
        recipient, please remove..."). "Remove" and "stop" count, as the
        brief says: a false "no" costs one prospect, a missed one emails
        someone who said stop. **No out-of-office guess from body words**
        ("I'll be back next week to look at it" is a person); one without
        headers waits for a label.
      - `replies.ts`: `checkReplies()` from the tick every ten minutes,
        paused or not: kyle@'s mail that isn't Kyle's own (spam included),
        matched to the email it answers by thread, then our Message-ID, then
        the address. Bounce: contact marked bad, follow-up cancelled,
        prospect closed. Opt-out: labelled no thanks in code, follow-up
        cancelled, on do-not-contact and fingerprinted (real sends only),
        Kyle told. Reply: follow-up cancelled, Kyle told (instant channel,
        so an email), waits for a label. After a business's first reply the
        thread is Kyle's: later messages aren't recorded, except an opt-out.
        A follow-up about to go reads its thread first (`threadSenders`) and
        is dropped if anyone wrote.
      - `applyLabel()` (Kyle's taps now, the morning run's in Stage 7):
        interested or question makes a lead (`source = 'outreach'`, due
        today, the quote, the fault, the Gmail thread link and their site in
        the notes, no product names, since the follow-up drafter reads
        them); later sets the card's day; the rest close; no thanks and
        complaint also go on do-not-contact; a complaint pauses everything;
        two wrong-fact labels switch that fault off. Labelling asks first
        for no thanks, complaint and wrong fact. Relabelling is refused.
      - Auto-pause over real first emails only, counted from Kyle's last
        resume (`auto_rules_since`): 3 bounces or 3 no-thanks in the last
        40, or 100 with nobody interested.
      - **Test sends never reach a business**, so nothing from them touches
        one: no do-not-contact, no fingerprints, no auto-pause, no fault
        off; a lead from one says [Test] and carries the test inbox.
      - "Send a test pair" now records the pair against a made-up test
        business (`test-pair-xxxx.invalid`), so a reply from the test inbox
        exercises all of this before Stage 7 brings real prospects.
      - **Send on weekends** (Kyle, 20 Nov): a setting, off until he ticks
        it; Saturdays and Sundays become sending days; holidays and the
        pause dates still stop sending. The warm-up and ceilings stay: kyle@
        has never sent mail, and a new mailbox sending 25 cold emails a day
        is how Gmail suspends senders (Kyle told; he can override).
      - 0066: `send_weekends`, `replies_checked_at`, `auto_rules_since`,
        `leads.source` gains outreach, an index. Passed on Postgres twice
        over, with 0062's and 0065's probes still passing. Code tolerates
        0066 missing (new columns read and written apart).
- [x] **Stage 7: the two connectors.** (Built and merged 20 Nov 2026, no
      migration.) OAuth resources and every tool. Test: a
      Draper token is refused by `/api/mcp` and by the advisor endpoint, and
      can reach no client, invoice or exclusion detail.
      - `src/lib/mcp/resources.ts` (pure, 6 tests): the three resources
        (`/api/mcp` "pipeline", `/api/mcp/outreach` "outreach", named Draper,
        `/api/mcp/outreach-advisor` "outreach-advisor"), which one a request
        is for (a named address decides; its scope only has to be among those
        asked for, since some clients ask for every listed scope; no address
        means the scope decides; nothing at all is the pipeline, as before),
        and `tokenFits`: a token works only at the exact address it was
        issued for. Draper's two exist only with the flag on.
      - `oauth.ts`: codes and tokens carry their resource's scope; the
        audience check is per address; the token endpoint refuses a resource
        other than the grant's. The pipeline connector is unchanged
        (same scope, same address, same server name).
      - `src/lib/mcp/server.ts`: the JSON-RPC handler, shared by all three
        routes; `/api/mcp` now calls it. The well-known protected-resource
        document answers per address (the bare one is the pipeline's) and is
        a 404 for anything else; the authorization-server document lists
        every live scope. Middleware makes `/api/mcp/(.*)` public (each
        checks its own token).
      - `src/lib/outreach/mcp-tools.ts`: outreach_brief (date, mode, the
        target: the next sending day's cap from slider, ramp and follow-ups,
        less every first email waiting; 0 with the reason when paused, both
        switches off, or no sending day), outreach_check_business
        (publicVerdict only), outreach_add_prospect (postcode, ABN, the
        published address and its page all required; blocked businesses
        refused; the ABN checked by the ABR when ABR_GUID is set, else
        Claude's reading must say active; MX provider looked up; test flag
        from test mode; 100 a day at most), outreach_measure (own site only,
        4 pages a prospect, stored as `initial`, returns the measurement_id,
        faults, ad signal, page names [[page]] may use, broken menu pages,
        and whether it qualifies), outreach_submit (submitDraft from Stage
        4), outreach_drop, outreach_replies_to_label, outreach_label_reply
        (applyLabel), outreach_numbers (events between Melbourne dates, by
        lane and fault, test apart, rates only from 30 sends). Advisor only:
        outreach_set_lessons, outreach_set_run_instructions (new versions,
        change log), outreach_set_test (plan, start, end; one live test).
      - `connector-safety.test.ts` reads the tools' own source: Draper's
        tables only (never clients, invoices, exclusions, do-not-contact,
        leads, tokens or the Gmail table), no sending path, block details
        never returned, one delete (its own half-saved prospect), and the
        three writes advisor only.
      - The consent page names the connector and what it can and can't do.
        The Draper page has a Connectors section: both addresses with Copy,
        whether each is connected, and a Disconnect that revokes only that
        address's tokens. Settings' Disconnect still cuts off a whole app,
        which for claude.ai may mean every connector at once.
- [ ] **Stage 8: pages.** Outreach, prospect card, Settings, Lists, Numbers,
      checked at phone width.
- [ ] **Stage 9: end-to-end test** in test mode (the brief's nine checks), then
      Kyle's setup list: Google Cloud and Google Admin steps, the exact
      environment variables, the two connector addresses, and what could not be
      tested.

## Working on the branch

Same two-copy setup as everything else in CLAUDE.md, on the branch:

```
cd C:\Users\kylea\pulse-verify
git checkout draper
git merge main                       # pick up anything shipped since
# edit the Drive copy, then sync it across:
robocopy "H:\My Drive\Website Code\hartwell-pulse" "C:\Users\kylea\pulse-verify" /E /XD node_modules .next .git /XF .env.local
npm run build
git add <the files, named>           # never git add -A
git commit -F <message file>
git push origin draper
# Kyle pastes the stage's migration; probe it landed. Then merge the stage:
git checkout main
git merge --ff-only draper
git push origin main                 # deploys, flag off
git checkout draper
```

- **While a stage is half done, the Drive copy holds Draper work in progress.**
  A fix to `main` in that time must commit a named file list from `main`, so
  half-built Draper files never ride along.
- If a session has to stop mid-stage, commit the work in progress to the
  branch (never `main`) and push, so it is on GitHub and on the other PC.
- On the other PC: `git fetch` then `git checkout draper` in its own
  clone.

## Kyle's list

Can start now:

1. **kyle@hartwelldigital.com** already exists as its own user, display name
   "Kyle Hartwell", licensed on 20 Nov. Sign in to it, turn on 2-step
   verification, read what's already in its inbox, add a signature, add it
   to the Gmail app on the phone, and send some normal mail from it while
   Draper is built: an address whose first act is cold email looks worse to
   Gmail and Outlook.
2. Register for an **ABR web services GUID** (free) on abr.business.gov.au
   (Web services). It goes in Vercel as `ABR_GUID` when Stage 3 asks.
3. Add hartwelldigital.com to **Google Postmaster Tools** (free) to watch the
   domain's reputation once sending starts.
4. Check **SPF, DKIM and DMARC** for hartwelldigital.com in Google Admin
   (brief step 4).
5. Decide **where the 5:30am task runs** (decision 9).
7. **For Stage 5 (sending):** in the same Google Cloud project, turn on the
   Gmail API; set up the Google Auth Platform as Internal, app name "Hartwell
   Pulse", scopes gmail.send and gmail.readonly; make a Web application
   OAuth client with redirect URI
   `https://portal.hartwelldigital.com/api/outreach/gmail/callback`. In
   Vercel: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (Secret),
   `OUTREACH_TOKEN_KEY` (Secret: 32 random bytes in base64, made on Kyle's PC;
   losing it only means connecting Gmail again). Redeploy, then Connect
   Gmail on the Draper page as kyle@, add the two test inboxes, Send a test
   pair. On cron-job.org: a job like the email one, URL
   `/api/cron/outreach-tick`, every 5 minutes, same Authorization header.
6. **Now needed for Stage 3:** a Google Cloud project with the **PageSpeed
   Insights API** turned on and an **API key** restricted to that API, in
   Vercel as `PAGESPEED_API_KEY` (Secret, Production). Without it Google's
   shared quota refuses the speed test. The same project serves the Gmail
   API in Stage 5.

11. **Three new faults and the forced test (21 Nov):** paste 0067, then its
   probe (3 checks). Then in a claude.ai chat with Draper and web search
   on, give it the forced-test prompt (below, in the 21 November log
   entry): one site only, the sample workshop. Pulse confirms an hour on;
   the pair sends on the next sending day into the test inbox; reply to it.
10. **For Stage 7:** in claude.ai, Settings, Connectors, Add custom
   connector: name Draper, address
   `https://portal.hartwelldigital.com/api/mcp/outreach`; connect and press
   Allow on the portal. Then in a chat with it on, ask for outreach_brief.
   The advisor connector waits until it's wanted. Then the 5:30am task
   (decision 9: where it runs).
8. **For Stage 6:** paste 0066, then its probe (6 checks). Then in Settings
   tick Send on weekends if wanted; Send a test pair, and reply to it from
   the test inbox: "Sounds good, tell me more" should show under Replies
   (tap Interested and a [Test] lead appears in the pipeline); on a second
   pair, "no thanks" should opt out by itself.
9. ~~Holiday dates~~: not needed. Kyle chose national holidays only (20 Nov).
   Check the pause dates in Settings: 18 December to 11 January stops all
   sending unless he changes them.

When a stage asks: the Google Cloud project, Gmail and PageSpeed APIs, the
Internal OAuth screen, the OAuth client and API key (Stage 5 gives the clicks);
the cron-job.org jobs; the Vercel variables; pasting each migration; the test
inboxes, client-area exclusions and imports (brief step 5); adding the two
connectors; the morning task (brief step 7).

## Environment variables (provisional; Stage 9 gives the final list)

New: `OUTREACH_ENABLED`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`OUTREACH_TOKEN_KEY`, `PAGESPEED_API_KEY`, `ABR_GUID`.
Reused: `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, the Supabase keys.
Kyle creates and enters every secret himself; none is ever pasted into a chat.

## Rules that still apply

- Never Resend for outreach: its terms forbid it, and client email depends on it.
- The words only: no links, no attachments, no tracking, no images, no
  styling. Each email carries the words twice, as plain text and as bare HTML
  (a div a line, as Gmail's composer writes a typed email), because Gmail's
  API re-wraps any plain-text-only body near 70 to 78 characters and phones
  then show ragged lines. **Kyle chose this on 20 November 2026** over his
  brief's "plain text only", after two test pairs came out ragged. Nothing
  replies to a person automatically. Claude never sends.
- Australian English, no em dashes, none of the banned words, in emails and in
  every page label. Follow `docs/BRAND-DIRECTION.md` in `hartwell-digital-v6_21`
  for any Hartwell copy: speak as "we", never describe the team, no fees or
  figures about what Hartwell charges.
- Clients never see any of Draper: admin guards AND row-level security.
- `do_not_contact` and the fingerprints are forever.
- **Do not resume Ironpeak cold outreach**, and keep the defence lane out until
  Kyle decides otherwise.
- Migrations are pasted by Kyle; write them idempotent and probe them.
- Nothing renders or measures inside a server action (10 seconds); route
  handlers only (60 seconds).

## Log

- **19 November 2026.** Kyle pasted the brief and asked for a plan first. Plan
  given with nine clashes; Kyle settled them (above) and asked for this branch
  and handover. Branch `draper-outreach` cut from `main` at 80fbe0b. Nothing
  built.
- **19 November 2026, later.** Kyle said go, and asked for the branch to be
  called Draper: renamed to `draper` (old name deleted on GitHub). Stage 1
  built: migration 0062, its probe, the flag, the menu entry, the read-only
  page, `npm test`. Build and tests pass; the probe passed 36 of 36 on
  Postgres 16. Waiting on Kyle to paste 0062 and the probe. Not yet merged to
  `main`.
- **20 November 2026.** Kyle pasted 0062 ("The SQL has been added"). Stage 1
  fast-forwarded into `main` and deployed, flag off. Still to confirm: the
  probe (`supabase/probes/0062_draper_probe.sql`) shows pass = true on all
  36 rows. Next: Stage 2.
- **20 November 2026, later.** Kyle asked for an alias instead of a second
  user, then found kyle@ already existed as its own user and licensed it.
  Decision 1 stands as first written; the alias plan is dropped.
- **20 November 2026, Stage 2.** Kyle's probe for 0062 passed 36 of 36 on
  the live database. Stage 2 built on the branch: normalising and hashing,
  matching, the widened do-not-contact list, the import, the Ironpeak file.
  41 tests pass; 0063 and its probe passed on Postgres 16, and 0062's probe
  still passes on top of it. Waiting on Kyle to paste 0063 and its probe,
  then to import the Ironpeak file and copy the do-not-contact list in.
- **20 November 2026, later.** Kyle pasted 0063; its probe passed 5 of 5 (the
  live do-not-contact list has 1 entry). Stage 2 fast-forwarded into `main`
  and deployed, flag off. Still to do: the flag on, the Ironpeak import and
  Copy it in; Kyle's OK to download the GeoNames postcode list for the
  client-area radius.
- **20 November 2026, Stage 3.** Kyle switched the flag on (Config,
  Production, redeployed), OK'd the GeoNames download and asked for Stage 3.
  Built: the client-area radius and the measuring tool, 0064 (screenshot
  bucket). 70 tests pass. Live test found three real-world problems, fixed:
  IPv6 connect timeouts, a server dropping parallel connections, and an
  empty script-built menu placeholder that would have lent body links to the
  menu. Waiting on Kyle: 0064 and its probe, PAGESPEED_API_KEY, ABR_GUID, and
  the Ironpeak import.
- **20 November 2026, later.** 0064's probe passed 3 of 3. Stage 3
  fast-forwarded into `main` and deployed. Neither PAGESPEED_API_KEY nor
  ABR_GUID was in Vercel yet.
- **20 November 2026, Stage 4.** Kyle added PAGESPEED_API_KEY (Secret,
  redeployed) and applied for the ABR GUID. Stage 4 built: tokens, lint,
  render, verify, submit, the contact re-fetch, "Check wording". 88 tests
  pass, including every refusal case in brief test 3 and a good draft that
  renders word for word like Kyle's reference example. No migration; merged.
- **20 November 2026, Stage 5.** Kyle said go from his phone (Remote Control
  on). Built the sender: schedule, Gmail, the tick, the queue, settings,
  0065. 99 tests pass; 0065 passed on Postgres. A self-review before commit
  caught three bugs: a test pair could split across two test inboxes, a
  follow-up could reach a real business whose first email went to a test
  inbox, and the 8am summary counted emails that had rolled over. Raised
  with Kyle: the window holds 11 to 18 sends a day, not 25. Waiting on
  Kyle: 0065, the Google and Vercel setup, the cron job, and his OK to
  download the holiday dates.
- **20 November 2026, later.** 0065's probe passed 4 of 4. Stage 5
  fast-forwarded into `main` and deployed. Still inert: no Gmail connection,
  no cron job, no holiday dates.
- **20 November 2026, evening.** Kyle did the Google setup (Gmail API on,
  Auth Platform Internal, both scopes, the Web client and its redirect) and
  added the three Vercel variables. His redeploy failed on an unrelated
  `next/font` Google Fonts fetch; `vercel redeploy` of the same build went
  Ready. Gmail connected as kyle@. The first test pair arrived with ragged
  lines: Gmail's API hard-wraps a text/plain body (sent as 8bit). Sending it
  quoted-printable (4d3c473) did not stop it: Gmail re-serialises plain text
  whatever encoding it's given. Kyle chose a bare HTML copy of the same
  words; the email is now multipart/alternative. Kyle added the cron-job.org
  job (`/api/cron/outreach-tick`, every 5 minutes, same header, GET).
  Still waiting: a clean test pair, his OK to download the holiday dates,
  and ABR_GUID.
- **20 November 2026, night.** The third test pair arrived clean. Kyle said
  yes to the holiday dates, asked to send on weekends, to send the most a
  day allows, and to start Stage 6. Told: no real email can go today
  (nothing finds businesses until Stage 7, the window had closed, and
  opt-outs must be handled before going live); the warm-up stays. The
  holiday download was refused by data.gov.au (403) and the local safety
  check stopped a retry with a browser user agent. Built Stage 6 and the
  weekends setting; 0066 passed on Postgres; 109 tests. A self-review
  dropped the body-words out-of-office guess, which would have hidden a
  real reply.
- **20 November 2026, later that night.** Kyle pasted 0066; its probe
  passed 6 of 6. Stage 6 fast-forwarded into `main` and deployed. Next for
  Kyle: tick Send on weekends if wanted, then the two test-pair replies.
- **20 November 2026, Stage 7.** Kyle said "start on stage 7, let's get
  Draper connected". Built the two connectors on the existing OAuth server
  (no migration), the shared MCP handler, every tool, the consent wording
  and the Connectors section; 118 tests. Reviewed the shared OAuth path
  before shipping, since the pipeline connector runs through it: relaxed
  the scope rule for clients that ask for every listed scope. Merged and
  deployed. The Drive mount dropped once mid-session (H: vanished, came
  back); no files were lost.
- **20 November 2026, night.** Kyle connected Draper and Draper advisor in
  claude.ai; outreach_brief answered through both (target 0, no sending
  day). He then dropped the holiday dates: send on public holidays except
  the big national ones. Built `nationalHolidays()` (Easter computed,
  weekend stand-ins), removed the empty table and the "year not covered"
  rule; the brief's target now counts real sending days.
- **21 November 2026.** Kyle ran the first morning run from claude.ai with
  Draper (test mode). It read 15 sites, measured 7, submitted none: four
  were only slow on a phone (one fault, even across four pages each), two
  had no ad signal, one had no fault at all. Draper's own read: the
  two-fault rule is the bottleneck, and it lacked a guide to how faults
  are measured. Kyle also switched the master switch on; test mode still
  wins, so nothing reached a business. The cron job was confirmed ticking
  every five minutes in Vercel's logs.
  - **Kyle chose to add three faults** (over "one fault on two pages
    counts", which would have made the first email's "we noticed another
    thing" point at the same problem): `layout_shift` (Google's layout
    shift 0.25 or more), `page_freezes` (total blocking time 600 ms or
    more on a phone), `no_mobile_layout` (no device-width viewport tag, a
    page not built by script). All from the same measurement, no form
    sent. 0067 widens the four fault constraints and keeps the readings
    (`psi_cls`, `psi_tbt_ms`, `mobile_viewport`, written apart from the
    insert). `schema.test.ts` now reads a constraint's newest definition.
  - The brief carries `FAULT_GUIDE` (tokens.ts): how each fault is decided
    and how to say it without a figure, and where each tends to hide.
    outreach_measure reports the layout shift, blocking time and phone
    layout too, marked "for choosing only".
  - **The sample workshop** (Kyle chose the portal over the website):
    `/sample-workshop`, `/canopies`, `/contact`, and a Gallery menu link
    that is a real 404; route handlers serving plain HTML (a Next page
    would add the viewport tag it must lack), public in middleware,
    noindex. Hartwell Digital's own name and ABN (honest for the ABN
    check), Caloundra QLD 4551 (lane 1's area), a fictional number in
    ACMA's 07 5550 range that isn't a tap-to-call link, and
    workshop@sample-workshop.invalid, which can never receive mail. A
    no-repeat check of exactly those details through Draper said allowed.
    Expected faults: broken_page, phone_not_tappable, no_mobile_layout,
    and the Google Ads tag for the ad signal.
  - The Draper page shows the last seven days' yield (added, submitted,
    confirmed, dropped, refused, sent, and added per submit).
  - **The forced-test prompt** for a claude.ai chat with Draper: "Forced
    end-to-end test. Use only this one site and don't search for others:
    https://portal.hartwelldigital.com/sample-workshop. It's Hartwell
    Digital's own sample page, ABN 44 286 503 049 (active, certainly
    Hartwell Digital's), in Caloundra QLD 4551. Check it, add it with the
    address on its contact page (a general inbox), measure the home page
    and the canopies page, write the slots and submit. Then stop."
  - Not done, for Kyle's yes in the Draper chat: letting directories be
    used to find business names (addresses still only from the business's
    own site), a run-instructions change through Draper advisor.
  - Later the same day: Kyle pasted 0067; its probe passed 3 of 3. Merged
    into `main` and deployed.
