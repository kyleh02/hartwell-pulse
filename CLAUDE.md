# Hartwell Pulse — project guide for Claude Code

Internal client portal for Hartwell Digital (Kyle Andruszkiewicz, sole trader, QLD).
Live at https://portal.hartwelldigital.com

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4
- Supabase (Postgres + Storage) — **RLS is the tenancy boundary**
- Clerk (production instance) for auth; Resend for email; Vercel Hobby hosting
- Repo: github.com/kyleh02/hartwell-pulse — pushing to `main` deploys to Vercel

## Working setup (two copies)
- **Source of truth for editing:** the Google Drive folder this file lives in.
  `npm install` DOES NOT work inside Google Drive (symlink/lock failures).
- **Build + deploy copy:** a local git clone. Sync Drive → clone with robocopy
  (`/E`, never `/MIR`), then `npm --prefix <clone> run build`, then commit and
  push from the clone.
- Paths on Kyle's machine: Drive is `H:\My Drive\Website Code\hartwell-pulse`
  (the same Google Drive is also mounted as `D:`), clone is
  `C:\Users\Kyle\pulse-verify`. The Ironpeak working folder, which holds
  `portal-handoff-pipeline.md`, is `H:\My Drive\Ironpeak Consulting Build`.
- The two copies differ in line endings on nearly every top-level file, so diff
  them through `tr -d '\r'` or everything reads as changed when nothing is.
- **Sync this file back to the clone and commit it.** The Drive copy stayed
  current through the whole pipeline rebuild while the committed one sat five
  commits behind, describing a dataset and a sending path that no longer
  existed. This file is the only thing a new session reads, so a stale one costs
  an afternoon the next time a chat is lost.
- `.env.local` is gitignored, and **the copy on this machine is a skeleton**. As
  of 18 August 2026 both copies carry the same 27 July file with every secret
  value blank, and no `MS_GRAPH_*` or `CRON_SECRET` keys at all. The live values
  exist only in Vercel. Nothing local can reach Supabase or draft into Outlook,
  and `npm run dev` will not reproduce what the portal does. Build and typecheck
  are unaffected, which is what the clone is for.

## Database migrations
- Live in `supabase/migrations/`, numbered. They are NOT auto-applied: Kyle
  pastes them into the Supabase SQL Editor manually.
- Write them idempotent: `add column if not exists`, `drop policy if exists`
  before `create policy` (Postgres has no CREATE POLICY IF NOT EXISTS),
  `drop trigger if exists`, guarded `do $$` blocks.
- **Applied state is not tracked reliably. Check it, never assume it.** This file
  used to record 0001–0036 as applied "as of 2026-08-07", but 0036 was written
  after that date, so the note cannot have been right. Nothing from 0037 to 0041
  has ever been recorded as applied at all.
- Probe what a migration creates rather than trusting a version note:
  `information_schema.columns`, `pg_proc.prosrc`, `pg_get_constraintdef`. 0039 is
  the one to check first, because it adds `draft_created_at` and the drafting
  cron uses that column to know a record is finished. Without it the same email
  lands in Drafts again every few minutes.
- The CRM prospect data is NOT a migration: it imports in-app from Pipeline,
  because 30 KB of string literals proved unreliable to paste into the Supabase
  SQL editor.

## Security model (do not weaken)
- Helpers `is_admin()`, `current_client_id()`, `clerk_user_id()` read the Clerk
  JWT; every client-facing table is client_id-scoped via RLS.
- Storage bucket `pulse-assets` is private; storage RLS requires the client_id
  as the FIRST path segment of every object.
- Service-role client (`createAdminSupabase`) only in trusted server code, and
  only after an explicit admin/role check.
- Postgres FK cascades do NOT re-check RLS — guard cascade paths with BEFORE
  DELETE triggers (see 0011/0017 for the pattern).
- Share links: hashed token + `/share/[token]/raw` proxy minting 60s signed
  URLs. Never expose a raw signed URL in HTML or email.

## Money rules
- **Always check the error on a write.** `saveInvoice` did not, and when a
  migration added a column that was not yet applied, the whole update was
  rejected silently: the invoice kept its defaults and a client was emailed an
  invoice for $0.00 on the wrong terms. An unchecked write on the money path is
  a fault waiting for an excuse. Adding a column to an existing write is
  exactly the moment this bites, since code ships before the migration is run.
- **Test to me** on any draft sends the real email to the admin, reading the
  SAVED row rather than form state, so a proof shows what is stored. Records
  nothing.
- **`invoices.recipient_user_ids` empty means EVERYONE on the account**, not
  nobody. Every invoice predating migration 0031 carries an empty array, and a
  one-contact client should never have to configure anything. Resolve it only
  through `invoiceRecipients()` in `src/lib/invoices-send.ts` — the send, the
  due-soon heads-up and the overdue chase all use it, and a fourth caller doing
  its own `client_users` query is how they drift apart. A chosen id that has
  left the account drops out and the send THROWS rather than falling back to
  everyone: falling back would email the person who was deselected.
- A new invoice inherits the last non-void invoice's recipients for that
  client, and the recurring cron copies the template's. Billing a two-person
  account usually means billing the same one of them each month.
- Kyle is NOT GST-registered → invoices default "No GST". AUD, en-AU formats.
- Sent invoices are never hard-deleted — VOID only (keeps number + audit trail;
  ATO 5-year record keeping). Drafts may be deleted. Paid and void are fully
  locked, in `saveInvoice` as well as the UI.
- **A SENT invoice may be corrected and reissued under the same number** (0033).
  For an unpaid one that is the ordinary fix, and it beats voiding and raising a
  new number, which leaves the client holding two documents for one job. What
  must never happen is a silent change, so every send writes an
  `invoice_sends` row snapshotting the amount, due date, revision and the
  addresses it reached. Snapshotted, not joined: a later correction is exactly
  what would otherwise rewrite that history.
- `revision` bumps only when an already-sent invoice is saved. `sent_at` is the
  FIRST send and never moves; `last_sent_at` carries resends. The client email
  says "Updated invoice" once revision > 0, because calling a correction a new
  invoice makes a client think they owe twice.
- Invoice numbering via `next_invoice_number()` sequence. Discounts are
  negative line items, netted into a Discount row in the totals.
- Recurring billing: template invoices with `recurring_active`; the daily cron
  materialises + auto-sends one invoice per template per month (unique index
  dedup), evaluated in Australia/Brisbane time.

## Documents (invoices and reports)
- Both carry a `brand` column, `hartwell` or `ironpeak`, and both dress in
  `doc-light brand-ironpeak` for Ironpeak. Shared identity lives in
  `src/lib/brand.ts`; never re-declare the Ironpeak details in a component.
- **A document must never hardcode a colour.** Chart strokes, bars and fills all
  read `--pulse-gold`, which `doc-light` swaps for steel. That is what lets one
  component serve both brands without a prop threaded down to it.
- The letterhead renders on screen AND in print, deliberately. A print-only
  letterhead means the first time anyone sees the branded document is after it
  has been sent.
- **Recipients: one rule, one implementation.** `resolveRecipients()` in
  `src/lib/recipients.ts` serves invoices, reports and every reminder that
  follows them. An empty `recipient_user_ids` means EVERYONE on the account
  (what all pre-existing rows carry, and right for a one-contact client). An
  empty RESULT means stop — never fall back to everyone, that would send to
  precisely the person who was deselected.
- **Publish and send are separate acts on a report.** Publish makes it visible;
  Send emails the chosen people and stamps `sent_at`. Migration 0032 dropped
  the `reports_notify` trigger that used to put a line in everyone's WEEKLY
  digest on publish: a finished report could sit unmentioned for six days.
- Reports have "Test to me", same as invoices, reading the saved row.
- `reports.summary` (everything above the first `##` in an imported draft, i.e.
  the at-a-glance block) was written by the importer and rendered by nothing
  for its whole life. It renders now and is editable as "Opening". If a report
  field exists, check something actually displays it.
- `findPlaceholders()` warns on `[ADD: ...]`, TODO, TBC before a send. Reports
  are written before all their numbers are in.
- The tab title on a report viewer is the suggested PDF filename, so it is
  `{client} - {title}`, and the admin preview uses the same one as the client
  page. A file called "Report preview.pdf" reaching a client is a mistake.
- Print pagination lives in the `@media print` block in globals.css. Headings
  keep with their text, table headers repeat per page, rows and cards never
  split, paragraphs use orphans/widows rather than `break-inside: avoid` so a
  long one can still flow. `report-page-break` on a section starts a new page,
  toggled per section in the editor and stored in the section's JSON `content`
  (which is why it needed no migration).

## Client website previews (0041)
- `client_previews` gives a build in progress a home: named pages, in order,
  with a note about what to look at. It replaced a staging URL pasted into a
  chat message, which meant the client hunting for the most recent one and
  never knowing whether it was still current.
- Many rows per client on purpose. A site is not one page, and "have a look at
  the services page" is the normal request.
- Rendered in an iframe, not screenshots: a screenshot is stale the moment it is
  taken and the point is watching something change.
- **The frame can be refused and there is no reliable way to detect it.** A site
  sending `X-Frame-Options` or a `frame-ancestors` policy renders blank, and
  cross-origin rules stop the parent asking why. So "Open in a new tab" is
  always on screen rather than a fallback that appears after a failure nobody
  can see, and a line underneath says what a blank panel means.
- Desktop, tablet and mobile widths, because how it looks on a phone is the
  first question anyone asks about a new site.
- `visible` hides a page rather than deleting it. Not ready to be shown is a
  normal state during a build, and losing the URL each time would be tedious.
  RLS enforces it, not the component.
- The Website tab only appears for a client that has a page to see. On a
  six-item nav, a tab that is always empty is a sizeable fraction of it.
- Chat turns bare URLs into links, parsed into elements rather than injected as
  HTML, and http and https only. A message crosses an account boundary, and
  `javascript:` in something that renders as clickable is not a place to be
  permissive.

## Portal shell
- **Cmd+K** opens `CommandPalette`, mounted in `Shell` for both variants. With
  no query it lists the nav; typing hits `searchEverything()`. That action is a
  flat sweep with NO role branching on purpose: it runs on the RLS client, so a
  client account gets their own rows and `crm_*` returns nothing. Adding a
  branch there would be a second access-control system to keep in step with the
  first.
- The header button exists because a shortcut nobody knows about is a shortcut
  nobody uses, and on a phone there is no keyboard to press it on. It opens the
  palette via a window event rather than lifted state.
- **Light mode** is `:root[data-theme="light"]` plus `THEME_SCRIPT` inlined in
  `<head>`, which must run before first paint or every load flashes. Dark is
  the default and `prefers-color-scheme` is deliberately NOT read: the portal
  looking different to a client than it does to Kyle, because of an OS setting
  neither of them chose, is a support question.
- **The light gold is a different gold.** `#b5a675` is about 2.3:1 on white,
  fine as a hairline and unreadable as text, so light mode uses `#8a7645` and
  `gold-light` (meaning "more prominent on hover") goes DARKER. Never assume a
  token flips to its literal opposite.
- The `@media print` token block lists all three root selectors so it beats
  `[data-theme="light"]`, which is more specific than a bare `:root`.
- Clerk's `variables` appearance is still hardcoded dark, so the UserButton
  popover stays dark in light mode. Left alone rather than risking auth UI that
  cannot be tested from here.

## Email delivery
- Every `sendEmail` writes an `email_events` row; the Resend webhook at
  `/api/webhooks/resend` moves it along. Status only ever moves FORWARD through
  `RANK` — webhooks arrive out of order and a late "sent" must never overwrite
  a "bounced".
- Signature verification is hand-rolled in `src/lib/svix-verify.ts` rather than
  pulling in `svix` for one route. The timestamp tolerance is not decoration:
  without it a captured request replays forever.
- `recordEmail` swallows its own failures after logging. Telemetry that can
  stop an invoice reaching a client is worse than no telemetry.
- "Sent" renders grey, not green. The gap between "we sent it" and "it arrived"
  is the entire point.
- Needs `RESEND_WEBHOOK_SECRET` in Vercel plus an endpoint configured in Resend.

## Ironpeak outreach: the portal drafts, Outlook sends
- **The portal does not send outreach, and that is not a preference.** On 10 and
  11 August 2026 four Graph sends produced four `550 5.7.708` rejections to four
  unrelated recipient domains, while every message Kyle typed by hand in Outlook
  the same day arrived, including a cold prospect sitting between two of the
  failures. Restricted entities was empty and SPF, DKIM and DMARC all passed, so
  it was neither an account block nor authentication. The remaining difference
  was the submission path: Exchange Online scores programmatically submitted
  mail separately, and anything tripping the outbound spam filter goes out
  through the high-risk delivery pool, whose IPs receiving servers reject with
  exactly that code.
- So `/api/cron/crm-send` calls `graphCreateDraft` at the scheduled minute and
  leaves a finished draft in Drafts with a deep link straight to it. Kyle presses
  send, then confirms in the portal. What that costs is sending while he is
  asleep. What it keeps is a delivery path that reaches people.
- **The Microsoft 365 tenant itself is blocked.** OWA returns
  `TenantAccessBlockedException`, which is a tenant-level block by Microsoft,
  not a password or licence fault, and DNS is clean. Version 4 of the handoff
  reads the four `5.7.708` codes as the earlier stage of the same thing: an
  outbound reputation flag that throttled programmatic submission first and
  escalated a week later. Manual sending did not work because it was manual, it
  worked because it was slower. **Do not resume scheduled sending until the
  block is resolved AND the sending arrangement has changed**, since cold
  outreach from `kyle@ironpeakconsulting.com.au` risks the mailbox the website
  contact form and live client correspondence depend on.
- `graphSendMail` has been deleted rather than left sitting unused. Restoring a
  send path from here is a worse idea after version 4, not a better one.
- **A draft is not a send, and nothing at draft time writes a touch.**
  `draftOutreach` composes; `confirmSent` writes the `crm_touches` row
  afterwards, from the same body. Logging at draft time would fill the Spam Act
  record with messages that never left, which is exactly the failure this
  replaced: evidence of something that did not happen is not evidence.
- `draft_created_at` (0039) stops the cron re-drafting the same email every few
  minutes. A record that cannot be drafted has `send_approved_at` cleared, so it
  stops being retried and starts being something to look at.
- Outreach never goes through Resend. Resend sends as hartwelldigital.com, the
  domain carrying every invoice and client notification, and cold mail there
  would risk the reputation of the mail that pays.
- Plain text, never HTML. A cold email that arrives as a styled document reads
  as marketing however good the words are.
- **Nothing drafts without `send_approved_at`.** The nine pre-send checks are
  ticked at APPROVAL, not at send: nobody is at the keyboard at 8:47am, and a
  checklist confirmed by a machine is not a check. Editing the body clears
  approval, because an email that changed is not the one that was read.
- `crm_dry_run_touch` asks the guard for permission BEFORE anything reaches the
  folder. A ready-to-send draft sitting in Drafts for a record that cannot
  lawfully be emailed is a trap for a tired thumb.
- **The opt-out is a reply, not a link,** and that was a correction rather than a
  preference. The link pointed at portal.hartwelldigital.com and was wrong on
  three counts, each sufficient on its own: the domain did not match the sending
  domain, which is a strong spam signal on cold mail; the token made it
  per-recipient tracking, which the settled rules forbid on first contact; and it
  published the tie between Ironpeak and Hartwell Digital to every prospect. A
  reply satisfies the Spam Act, which asks for a functional low-cost opt-out that
  is honoured, and honouring it is the operator's job: the guard blocks every
  channel the moment `opt_out_at` is set. `/unsubscribe/[token]` still exists and
  still works on GET, it is simply not linked from an email any more.
- The signature and the opt-out are appended in `buildOutreachText`, never
  stored in a body. A footer retyped 30 times is wrong on at least one of them.
  Pre-send check c6 exists for the inverse risk: a body pasted in with its own
  signature already attached goes out carrying two.
- The nine checks live once, in `src/lib/crm-presend.ts`, imported by both the
  manual flow and the automated one. They used to be two copies of the same
  array, which made the automated path the easy way to skip a check.
- Env: `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`,
  `IRONPEAK_SEND_FROM`, all in Vercel only. Application `Mail.Send` grants
  access to EVERY mailbox in the tenant, so scope it with an Exchange
  ApplicationAccessPolicy.
- `/api/cron/crm-send` runs every few minutes from cron-job.org. Vercel Hobby
  caps its own crons at daily and these are scheduled to the minute.

## CRM (admin only, two brands)
- One CRM, two pipelines, toggled by `?brand=` on /admin/crm: **ironpeak** and
  **hartwell**. Prospects, lists and metrics are all brand-scoped so a reply
  rate from one client base never averages into the other.
- **The rule sets differ, deliberately.** Ironpeak's gates (two-email cap, a
  dated and verified fault before a first email, nine pre-send checks) are
  defence *playbook strategy* and fire only for `brand = 'ironpeak'`. Applying
  them to Hartwell Digital's general client base would make the CRM unusable
  for it.
- **Universal for every brand, because it is law not strategy:** the Spam Act
  2003 covers every commercial electronic message sent in Australia, so the
  opt-out and the full consent trail are required before any outbound email is
  logged, whichever brand it is.

## Ironpeak specifics
- Ironpeak Consulting is a **registered business name against Hartwell Digital's
  ABN 44 286 503 049**, trading in defence only. Internal surfaces may say
  Hartwell is the parent; **client-facing output must not** — no "a business of
  Hartwell Digital", no dual logos. The bare ABN line is the only permitted
  expression of the parent.
- `crm_*` tables are admin-only (`is_admin()`), so clients never see a prospect.
- **The live pipeline is `src/lib/crm-pipeline-v2.ts`: 30 companies, applied by
  "Load 7 Aug pipeline" on /admin/crm.** It is GENERATED by
  `scripts/gen-pipeline.py` from `portal-handoff-pipeline.md` and never
  hand-edited: 19 email bodies retyped by hand is 19 chances to change a word
  Kyle chose, and he has explicitly rejected specific phrasings. Change the
  markdown and regenerate.
- The current data is **version 4, 18 August 2026**, loaded by "Load v4
  pipeline". Version 4 rewrote 16 of the 19 bodies to the shape fault, second
  observation, scope block, link, costless close, at 150 to 175 words, merged
  the greeting into the opener, and corrected Owen International's subject,
  which called DISP an accreditation and would have gone out that way. **Two
  exceptions are deliberate and must not be normalised:** Kennewell runs 198
  words with no link, because its offer is a caption pass rather than a
  rebuild, and Universal Motion Simulation opens "Good morning Dr Meikle".
- **`HARD_WARNINGS` in the generator is keyed by rank number, not by company.**
  Ranks held across version 4, so the five warnings still land correctly, but
  if a future handoff re-ranks anything that dict has to move with it or the
  PRP founder constraint attaches to the wrong company.
- **Sixteen sends from 12 to 17 August have an unknown outcome.** Nothing wrote
  back to the handoff after the 11th and the mailbox cannot be opened, so the
  portal must not assume they sent or did not. `src/lib/crm-unresolved.ts`
  derives them from the pipeline file (not from `scheduled_send_at`, which a
  reschedule overwrites) and flags them on the plan and again in the composer at
  approval. It WARNS rather than blocks: a record that genuinely did not send
  has to stay approvable, and there is nowhere to record "confirmed not sent"
  without a migration. Logging the send clears the flag, which is the same
  record the Spam Act defence rests on.
- **Replacing the pipeline clears `draft_created_at` as well as the approval.**
  The cron reads a non-null value as "done", so a record drafted under an old
  body would never draft again and the rewritten email would sit approved and
  silently undraftable. Drafts already in Outlook still hold the OLD text and
  have to be deleted there by hand.
- It REPLACES every earlier dataset, and the earlier datasets are **gone**.
  `crm-seed-data.ts`, `crm-pipeline-master.ts` and the four actions and two
  components that applied them were deleted with version 4: every one of them
  would have resurrected the companies that were deliberately triaged out. The
  target-NN research files in the Drive folder are superseded too and must not
  be re-imported. `replacePipeline` creates the companies it cannot find, so it
  bootstraps an empty pipeline on its own and nothing else was needed.
- **The offer was repositioned on 7 August 2026** from capability statements to
  websites. The first 14 sends led with a capability statement and produced
  zero replies in eight days; across ~50 researched companies at least nine had
  paid an agency for a website and none had a capability statement. Every hook
  is now a specific verified fault on the company's own site.
- **Part H of the handoff is the only clock.** Part E dropped `send_at` so the
  two can no longer disagree: Part E supplies structured fields, Part H supplies
  the times. The parser reads the whole of Part H and relies on the strict time
  format to keep other tables out. It used to slice at section 2, which was
  harmless until a rebuild moved the schedule there and it silently returned
  zero rows.
- **Replace UPDATES, it never wipes.** Companies that already exist are updated
  in place so the touch log survives, and that log is the Spam Act defence. A
  company dropped from the list but carrying a logged send is marked `lost`,
  never deleted. The portal's stage wins where the portal knows more, with two
  exceptions: `bounced` and `email_closed` are things only the file knows, so
  the file wins outright on those.
- **`bounced` is not terminal.** Nobody saw the message, so nobody refused
  anything. Bounced touches are also excluded from the two-email cap, which used
  to count them and spend one of two on a message nobody read. The touch itself
  stays, because it is a true record of an attempt and deleting evidence to fix
  arithmetic is the wrong trade. A re-send logs as `email_1`: a message nobody
  received is still the first one they will read.
- **`email_closed` ends one channel, not all of them.** Their mail server refuses
  this sender, so email is not viable, but LinkedIn and the phone stay open.
  Coastal Aviation is the case it was built for.
- Anything filtering by stage for sending must include `queued`, `contacted` AND
  `bounced`. That filter has been too narrow three times, and each time the
  symptom was silence rather than an error.
- **`scheduled_send_at`, `draft_created_at` and a logged touch are three
  different things.** The first is when it is planned to go, the second means it
  is written and sitting in Drafts, and the touch is the actual send: that is
  what advances the stage, counts toward the goal, and stands as the Spam Act
  record.
- `/admin/crm/plan` is the run sheet: the whole schedule as one table, then
  overdue follow-ups and sends grouped by day. The board answers "where is
  everything", the plan answers "what am I doing today".
- **Lay out the schedule** (`autoSchedule`) applies the fixed rules in one press
  rather than by hand in SQL: four a day, weekdays only, never on the hour or
  half hour, WA at 11:00 AEST or later so it lands mid-morning Perth, and a
  follow-up inside its day 8 to 10 window rather than before it opens. The window
  beats the four-a-day shape, because a follow-up sent early is worse than a day
  carrying five. Slot times are the ones already proven in the handoff, so a week
  of them still reads as a person at their desk. Anything already drafted keeps
  its time; blocked, LinkedIn-only and email-closed records get no slot at all.
- **Stages `blocked` and `linkedin_only`, and terminal `declined`/`stopped`/
  `do_not_contact`, are enforced in `crm_touch_guard`,** not just shown. Tynbell
  is blocked because their website went down, taking the conspicuous publication
  that created inferred consent with it.
- `email_source_note` holds where the address appears in words ("footer and
  contact page"). It is NOT a URL and must never be turned into one: what the
  Spam Act needs is that it was published plus when it was checked, and a
  fabricated URL fakes the one thing that has to be checkable.
- `hard_warning` is undismissable. PRP Manufacturing's founder died in November
  2021: never reference the founder or company history. Micca Holdings has no
  LinkedIn, so email only and never attempt a connect.
- A hook older than 14 days may not be quoted without re-verification, and the
  guard refuses it rather than warning about it.
- **Absence claims are the ones that go wrong.** Kennewell was wrong twice and
  Micron once, all the same way: a claim about "your site" built from one page,
  or from text alone. Kennewell's "empty" work page holds 29 photographs and
  Micron's about 63, both loaded by JavaScript. Crawl every page, count images
  and gallery markers rather than text, and prefer presence claims: "I found
  this on your site" is provable, "there is no X" is not.
- Prospects belong to a **source list** (`crm_lists`). Provenance is what makes
  a first email specific, and it stops reply rates from different sources being
  averaged into one meaningless number. New batches get their own list.
- `email_as_published` and `direct_email` are **different fields on purpose**.
  The published one is the consent evidence and must never be overwritten by a
  personal address given later.
- The compliance trail is the point, not a nicety. Cold outreach relies on
  **inferred consent under the Spam Act 2003**, which only attaches to an
  address the business itself conspicuously published. `email_as_published` is
  stored **verbatim** (never trimmed or lowercased) with its source note and
  verified date, because those three are the legal defence.
- Rules enforced by database triggers, not just UI: one contact per
  organisation; hard block on touching an opted-out contact; two emails then the
  sequence closes (lifts once they reply); a first email needs a **verified
  fault carrying a verification date no older than 14 days**; all nine pre-send
  checks ticked, stored per touch.
- Logging a send is what advances the stage, counts towards the daily goal, and
  books the LinkedIn request and the day 8 to 10 follow-up. LinkedIn connect
  roughly two hours after each send, under 200 characters, mention the email,
  no pitch.
- Goals are 3 a day and 15 a week, set by Kyle on 30 July 2026. The outreach
  playbook benchmarks 3 a WEEK, so this runs five times that rate: the abort
  warning (15 sends, no substantive reply) now lands after about a week rather
  than five. Kyle was shown the trade-off and chose the faster pace.
- Benchmarks that do not change: 2 to 3 substantive replies per 15 sent, and
  **zero opt-outs** — that last one is the health metric, shown first.

## Celebrations and gamification
- Admin surfaces only. Clients are businesses and defence buyers are
  conservative, so confetti in a client portal would read as unserious.
- `celebrate()` in `src/lib/celebrate.ts` fires on OUTCOMES, never activity:
  finishing the day's goal (once), a substantive reply, an invoice marked paid.
  **Never celebrate a send.** The playbook says volume is the risk, so
  rewarding each send would train the behaviour that gets a campaign
  complained about. Sending an invoice gets nothing either; being paid does.
- Honours `prefers-reduced-motion`: the toast shows, the confetti does not.

## Platform constraints
- Vercel Hobby: crons max once daily (sub-daily jobs run via cron-job.org
  hitting `/api/cron/*` with CRON_SECRET). No WebSocket hosting.
- Never put `next/image` in front of Supabase signed URLs (rotating tokens
  defeat its cache and burn the Hobby optimiser quota). Thumbnails are
  self-generated WebP at upload, served as plain lazy `<img>`.
- Supabase image transforms are Pro-only — don't rely on them.

## House copy rules
Australian English. No em dashes. No AI clichés. Friendly, plain, direct.
