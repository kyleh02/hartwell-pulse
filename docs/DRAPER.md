# Draper: automatic outreach (handover)

**Status, 20 November 2026: Stage 1 (data) done. Kyle pasted migration 0062
on 20 November and Stage 1 is merged into `main` with `OUTREACH_ENABLED`
unset (Draper hidden). The probe's 36 rows are still to be confirmed.**
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
   - **Changed 20 November 2026, by Kyle: kyle@ is an alias on admin@, not
     its own user**, to save the licence. Emails still go out as "Kyle
     Hartwell <kyle@hartwelldigital.com>", through Gmail's send-as.
     Replies to kyle@ land in admin@'s inbox, and admin@ is set to reply
     from the address a message was sent to. What this costs, accepted:
     - Connect Gmail (Stage 5) signs in as **admin@**, so the token can read
       all of admin@'s mail, client threads and invoice replies included.
       Gmail has no narrower scope that still shows reply text. So **the
       code reads only threads Draper started (by stored thread id), never
       lists or searches the inbox**, and Stage 5 tests that.
     - Outreach replies arrive among client mail. A Gmail filter on
       "to: kyle@hartwelldigital.com" labels them.
     - Moving to a separate user later means disconnecting and reconnecting
       Gmail, and doing it only when no follow-up is due, so no thread
       breaks.
     - The name "Draper" is never the address: the brief keeps it out of
       every email, and the From line is the first thing a business sees.
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
- [ ] **Stage 2: the no-repeat rule.** Normalising and hashing, matching
      against fingerprints, leads, clients, do-not-contact, exclusions and other
      prospects; widened do-not-contact; the CSV import; then the Ironpeak lists
      (`H:\My Drive\Ventures\Ironpeak Consulting\Leads\contact-register.csv` and
      `Defence outreach, ready to send, 21 Oct 2026.xlsx`, converted by Claude).
      Test: each kind of block, including a "no" from one address blocking its
      business.
- [ ] **Stage 3: the measuring tool.** PageSpeed mobile, HTTP and HTTPS
      fetches, menu links, the tags, Meta Pixel PageView counts, phone and
      `tel:` checks, the screenshot to storage, raw JSON, the six faults, the
      confirmation re-run. ABR check. Test: known sites, Kyle's own included.
- [ ] **Stage 4: submit, verify, lint.** Template v1 rendering with Pulse-filled
      figures, claim checks, contact page re-fetch, every lint rule. Test: every
      refusal case in brief test 3, and a good draft passes.
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

1. ~~Create kyle@ as its own user.~~ **Changed 20 Nov:** add
   **kyle@hartwelldigital.com** as an alias on admin@ in Google Admin, add it
   under Gmail's "Send mail as" with the name "Kyle Hartwell", and set
   "Reply from the same address the message was sent to". Send some normal
   mail from it while Draper is built: an address whose first act is cold
   email looks worse to Gmail and Outlook.
2. Register for an **ABR web services GUID** (free) on abr.business.gov.au
   (Web services). It goes in Vercel as `ABR_GUID` when Stage 3 asks.
3. Add hartwelldigital.com to **Google Postmaster Tools** (free) to watch the
   domain's reputation once sending starts.
4. Check **SPF, DKIM and DMARC** for hartwelldigital.com in Google Admin
   (brief step 4).
5. Decide **where the 5:30am task runs** (decision 9).

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
- **20 November 2026, later.** Kyle chose an alias instead of a second
  Workspace user: kyle@ sends as an alias on admin@. Decision 1 and Kyle's
  list updated with what that costs (the Gmail token can read admin@).
