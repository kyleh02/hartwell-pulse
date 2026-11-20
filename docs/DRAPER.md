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
no migration, merged into `main` 20 November. Next: Stage 5, the sender.**
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
- [ ] **Stage 5: sender.** Connect Gmail, the window and random gaps, holidays
      and pause dates, the slider, ramp and hard ceilings, "Check these" past
      12 from 12:30pm, the 8am summary, the stop window, "Don't send", pause
      all, the pre-send re-check, the day-7 threaded follow-up, test mode, lane
      approval. Test: clock tests on the rules, then real sends to the test
      inboxes.
- [ ] **Stage 6: replies.** Thread polling, opt-out words, bounces,
      out-of-office, labels, leads, "later" cards, every auto-pause rule. Test:
      real replies from the test inboxes.
- [ ] **Stage 7: the two connectors.** OAuth resources and every tool. Test: a
      Draper token is refused by `/api/mcp` and by the advisor endpoint, and
      can reach no client, invoice or exclusion detail.
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
6. **Now needed for Stage 3:** a Google Cloud project with the **PageSpeed
   Insights API** turned on and an **API key** restricted to that API, in
   Vercel as `PAGESPEED_API_KEY` (Secret, Production). Without it Google's
   shared quota refuses the speed test. The same project serves the Gmail
   API in Stage 5.

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
- Plain text only, no links, no attachments, no tracking. Nothing replies to a
  person automatically. Claude never sends.
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
