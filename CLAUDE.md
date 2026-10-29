# Hartwell Pulse — project guide for Claude Code

Internal client portal for Hartwell Digital (Kyle, sole trader, Melbourne).
**Clients only ever see "Kyle".** On 29 October 2026 Kyle said the surname this
file and the portal used to carry is not his; `HARTWELL.person` is first name
only and admin-authored approval events always show `HARTWELL.personFirst`.
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
- **ALWAYS exclude `.env.local` from that sync** — `/XF .env.local`, alongside
  `/XD node_modules .next .git`. The Drive copy's `.env.local` still carries the
  blanked values from the dead PC, and a plain `/E` copies it over the clone's
  working secrets, which are not in git and cannot be recovered from disk. Full
  command:
  `robocopy "<drive>" "<clone>" /E /XD node_modules .next .git /XF .env.local`
  If it is clobbered anyway it CANNOT be fully restored. Vercel marks these
  variables Sensitive, which is write-only: `vercel env pull` returns
  `[SENSITIVE]` placeholders, not values. Each secret has to be re-copied from
  its own dashboard — Supabase URL, anon key and service_role key from Supabase
  Project Settings > API; `CLERK_SECRET_KEY` from Clerk API keys; the Clerk and
  Resend webhook secrets from their webhook endpoints. `RESEND_API_KEY` cannot be
  recovered at all: Resend shows a key once at creation, so it must be reissued
  and updated in Vercel too. Losing this file costs an hour; the `/XF` above is
  what prevents it.
- Paths on Kyle's machine: Drive is `H:\My Drive\Website Code\hartwell-pulse`
  (the same Google Drive is also mounted as `D:`), clone is
  `C:\Users\kylea\pulse-verify`.
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
- **0044 to 0046 were NOT applied until 23 October 2026**, although this file
  said the 2 September probe confirmed everything through 0046. The admin
  dashboard's "Add it" failed with `Could not find the table
  'public.work_items' in the schema cache`, and re-running the three together
  (`supabase/fix-work-items.sql`, which records whether the table existed
  first) returned `existed_before = false`. So the dashboard had never been
  able to save, and nobody saw it because `listWork` and `getWorkStrip` ignore
  read errors: a missing table rendered as an empty list. Treat the 2 September
  claim as covering 0001 to 0043 at most. 0047 to 0052 were each run by Kyle as
  their feature shipped in October. Re-probe after any new migration rather
  than trusting a line here: attempt a zero-row select on the object a
  migration creates (`select <column>` or `select *` with `head: true`) and
  read the error code. `42P01`/`PGRST205` means the table is absent,
  `42703`/`PGRST204` means the column is.
- **Applied state is not tracked anywhere, so check it, never assume it.** This
  file used to record 0001–0036 as applied "as of 2026-08-07", but 0036 was
  written after that date, so the note cannot have been right. That is the
  reason for probing: `information_schema.columns` for a column,
  `pg_proc.prosrc` for what a function body actually says,
  `pg_get_constraintdef` for a check constraint.

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
  dedup).
- **Dates are Australia/MELBOURNE, from `src/lib/business-time.ts`.** Kyle moved
  there in 2026 and Melbourne observes daylight saving where Queensland does
  not, so the offset is no longer a constant. One constant, imported; never
  hardcode a zone again. And never read a date off `toISOString()`, which is
  UTC: between local midnight and 10 or 11am it is still on YESTERDAY. Four
  places did, so the dashboard, the work generator, the overdue chase and the
  CRM health check each spent a third of every day a day behind, and an invoice
  due today read as overdue.
- **An invoice may be SPLIT into instalments** (0050), each a row in `invoices`
  with `parent_invoice_id`, so each one inherits the PDF, the print route, the
  send, the client view and the reminders rather than reimplementing them.
  `split_at` on the parent is the single rule for not counting money twice:
  superseded, excluded from every balance, never chased. The instalment maths is
  in `src/lib/instalments.ts` in INTEGER CENTS, not the floats the rest of the
  invoice maths uses, because a split has to reconcile exactly against its
  parent. The last instalment is never calculated: it is the remainder of the
  parent, which is where rounding lands.
- **Every balance is `outstandingOf()`, total less deposit.** The document always
  showed amount due that way and every aggregation summed the raw total, so any
  invoice carrying a deposit overstated on the dashboard, in the work list and
  in reminder emails to clients.
- The scheduled instalment send CLAIMS before it sends, by inserting an
  `invoice_sends` row with `kind = 'scheduled'` against a unique index. A
  timestamp comparison leaves a gap between read and write that two runs can
  both pass through, and an email cannot be taken back.

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
- Reports have "Test to me", same as invoices, reading the saved row. It is
  offered on a DRAFT as well as a published report: checking a report is right
  is what you do before the client can see it, and making publishing the price
  of a test had that backwards. It carries the PDF, and the result names the
  file it attached or says plainly that none was, because "it looked fine" does
  not answer "did the attachment go".
- `reports.summary` (everything above the first `##` in an imported draft, i.e.
  the at-a-glance block) was written by the importer and rendered by nothing
  for its whole life. It renders now and is editable as "Opening". If a report
  field exists, check something actually displays it.
- `findPlaceholders()` warns on `[ADD: ...]`, TODO, TBC before a send. Reports
  are written before all their numbers are in.
- **The report body is a closed Markdown subset in `ReportText.tsx`, not a
  library**, so nothing in a body can inject markup. Paragraphs, `- ` bullets,
  `1. ` numbered lists, `### ` subheadings, pipe tables (header needs a
  `|---|` divider row), `**bold**`, and four fenced blocks: ```stats,
  ```bar Title, ```compare Title and ```note Title. The fences exist because a
  column of numbers in a table is data and a report is meant to make a point.
- Numbered lists render as `<ol>` and take their numbers from position, not
  from what was typed, so inserting a step does not mean renumbering the rest.
  The ONE exception is the first item of a list: start it at 4 and the list
  starts at 4, which is how a set of recommendations split under two
  subheadings stays one sequence instead of restarting.
  `note` is one style rather than a light and a dark one: two boxes competing
  for the same job is a decision to make on every callout for no gain.
- **Invoices carry a PDF too** (0043), and the machinery is shared: one
  renderer (`pdf-render.ts`), one signed print token, one card. Two copies of a
  headless browser launch is two places for the theme seeding, the wait
  condition and the page size to drift apart, and the first sign of that would
  be one document type printing correctly and the other not.
- **NOTHING renders inside a server action. Ever.** An action inherits the
  page's ten seconds on Hobby and a cold Chromium start does not finish in ten.
  The invoice send did render, once, and pressing Send hung and died with a
  blank screen. Rendering happens in route handlers, which can ask for sixty
  seconds: `/api/invoices/[id]/pdf`, `/api/reports/[id]/pdf`, and the recurring
  cron. The editor calls the route BEFORE calling the send action.
- **An invoice send never stops for a missing PDF**, which is still inverted
  from reports. A report send halts if its attachment cannot be read because a
  person is there to read the message; an invoice goes regardless, because the
  recurring cron sends it with nobody watching and an invoice that does not
  arrive is worse than one carrying a link.
- The print token is signed with the KIND as well as the id, so a token minted
  for a report cannot be pointed at an invoice. Both print routes are public,
  and that signature is the only thing between them and the world.
- **The send email carries the PDF** (0042). A client told their report is
  ready and handed a portal link has a sign-in between them and the thing they
  were promised, and anyone they forward it to has no login at all.
- **The portal GENERATES the PDF on publish** (headless Chromium via
  `puppeteer-core` + `@sparticuz/chromium`). It used to be printed by hand and
  uploaded, on the reasoning that a renderer would attach a document nobody had
  looked at. That reasoning was kept and the tedium was not: publishing makes
  the file and attaches it, and NOTHING sends it, so it is still opened and
  read before Send. Four steps became none.
- **Rendering is deliberately off the send path.** Chromium is slow to start
  and a serverless timeout is a real outcome, and none of that may stop a
  client's report reaching them. A failed render leaves the previous PDF alone,
  says why, and the manual upload still works exactly as it did. Keep it that
  way.
- The renderer opens `/print/report/[reportId]`, which is public in middleware
  and carries its own check: an HMAC token scoped to that one report id and
  good for five minutes, signed with `CRON_SECRET`. A headless browser cannot
  hold a Clerk session, so the page has to prove the request is ours by itself.
  It renders the SAME `ReportViewerChrome` the client sees rather than a
  print-only twin, because two documents drift the first time only one changes.
- `serverExternalPackages` must keep `@sparticuz/chromium` and `puppeteer-core`
  out of the bundle, or the executable never arrives and the launch fails on a
  path that does not exist. The route sets `runtime = "nodejs"` and
  `maxDuration = 60`: a server action inherits the page's ten seconds, and a
  cold render does not finish in ten.
- **An invoice can carry extra documents** (0051, `invoice_attachments`), sent
  in the same email as its PDF and downloadable from the client's invoice page.
  Up to 5, 10 MB together: Resend refuses an email over 40 MB AFTER base64,
  which inflates a file by a third, and the Send button is a server action with
  ten seconds to fetch every file and hand it over once per recipient. Files sit
  in `pulse-reports` under `<client_id>/<invoice_id>/attachments/`, so the
  existing storage policies cover them. A document that cannot be read STOPS a
  hand send before anything goes, naming it; an unattended send (instalment or
  recurring cron) goes anyway and says what was left off in the admin
  notification. Recurring templates do NOT pass them to the monthly invoices,
  which send the moment they are made. The test send names every file it
  carried, on screen. `invoice_sends.attachment_names` records what each send
  carried.
- **Client billing details** (0052): legal name, ABN, billing address and an
  attention-to name on the client's profile (the Edit dialog on /admin/clients),
  printed in the invoice's Bill to block. The ABN is stored as 11 bare digits
  and checked against the ATO checksum in the form AND the action, because a
  wrong ABN on a tax invoice names a different business. All in
  `src/lib/billing.ts`.
- **An invoice keeps the details it was ISSUED with.** A draft shows the profile
  live; every real send freezes it onto `invoices.bill_to`; saving a SENT invoice
  (a correction about to be reissued) refreshes it. So editing a client never
  rewrites what an invoice already in their inbox says, and the portal keeps
  matching the PDF they hold. 0052 froze every pre-existing sent invoice as the
  business name alone, which is all it ever showed. Renaming a client therefore
  no longer reaches sent invoices, deliberately.
- **Send, Resend and Test to me all make a FRESH PDF** unless the attached one
  was uploaded by hand (`pdf_source = 'uploaded'`, a deliberate override). They
  used to render only when no PDF existed and resend never rendered, so a draft
  edited after its PDF was made went out with the old figures while the screen
  showed the new ones. The crons already rendered every time.
- **New columns go in their own update, tolerant of `isMissingColumn`**
  (`src/lib/db-errors.ts`), never added to an existing write. Code ships before
  Kyle runs the SQL, and one refused combined update is how a client was once
  emailed a $0.00 invoice.
- **Never upload a file through a server action.** Next caps an action body at
  1 MB by default and Vercel caps any request at 4.5 MB. Upload browser to
  storage directly (chat and `InvoiceAttachments` do), then call an action with
  the path, and have the action check the path belongs to the record and read
  the real size back from storage rather than trusting the browser. The older
  manual PDF upload in `DocumentPdf` still goes through an action, so it fails
  for any PDF over 1 MB. Generated PDFs are far smaller, which is why it has
  never shown.
- If a PDF is attached it MUST go: a download failure stops the send with a
  message rather than quietly degrading to a link-only email nobody knows is
  degraded. The test send carries it too, because a proof that leaves out the
  thing being changed is not a proof.
- **Every body field in the editor has a live preview beside it**, rendered by
  the document's own `ReportText` with the document's own styles, so what is
  shown is what prints. It is ONE setting for the whole editor, owned by
  `ReportEditor` and remembered in `localStorage` (`pulse.report.preview`), not
  a switch per card: the answer was the same on every section of every report.
  Storage rather than the report row or the user, because it describes how a
  browser window is being used rather than anything about the document, and it
  should not travel between machines or be something a save can conflict over.
  It starts off and corrects itself on mount, since reading storage during the
  first render makes the server and client disagree about what to draw. The draft is Markdown with pipe tables and fenced
  charts in it, and the only way to see whether a table lined up used to be
  save, leave, open the viewer, come back. The box is monospace and grows to
  fit: pipes only read as a table when they line up, and a fixed six rows means
  editing a table through a letterbox.
- `pdf_uploaded_at` older than the report's `updated_at` means the attachment
  is stale, and the editor says so. Nothing can tell that from the file, so the
  two timestamps are simply shown to disagree.
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

## Client Home and the chat bubble
- **A client lands on Home (`/dashboard`, labelled Home in the nav), not an
  analytics page.** The old page was a heading over an empty box for every new
  client, so the first screen of the relationship was an absence. Home greets
  them ("Welcome to your portal" while getting started, "Welcome back" after),
  counts days with Hartwell Digital from `clients.created_at` in business time,
  and gives every part of the portal a tile carrying its real state. The
  analytics moved to `/dashboard/performance`, linked from the Home metrics
  strip, which is why Home is a PREFIX match in `isNavActive`.
- All of it loads in `getClientHome()` (`src/lib/client-home.ts`). Every query
  filters by client_id explicitly even though RLS already scopes a client: the
  admin preview reads with admin RLS, and the filter is what pins it to one
  client. The invoices tile uses `isSuperseded` and `outstandingOf`, like
  every other balance.
- **Getting started ticks itself from what happened**, never from a click: said
  hello = any message with `sender_role = 'client'`, shared files = any asset
  with `uploader_role = 'client'`. When both are done the card goes and the
  greeting changes. No column, no migration.
- The admin preview (`/admin/clients/[id]/preview`) renders the same
  `ClientHome` with `preview`: tiles do not link and the chat buttons are inert,
  then the performance view underneath.
- **The chat bubble (`ChatLauncher`) is on every client page except Messages**,
  mounted by `Shell` from conversations the client layout fetches once. It is
  the same `ChatThread` as the Messages tab with `fill`, so there is one chat
  with two ways in. The thread mounts ONLY while the panel is open, because
  ChatThread marks messages read as it shows them and a hidden one would tell
  Kyle a message had been seen. Below 640px it is full screen; up to lg it sits
  above the tab bar; `main` gets extra bottom padding so a page's end scrolls
  clear of the bubble. `openChat()` opens it from anywhere.
- **Escape inside the panel belongs to the innermost thing.** The chat search,
  the message edit box and the image lightbox call `preventDefault` on Escape,
  and the panel closes only on an Escape nobody claimed. A new Escape handler
  inside the chat must do the same, or one key press closes two things.
- Kyle's contact details on Home come from `HARTWELL` in `src/lib/brand.ts`
  (`person`, `email` = admin@hartwelldigital.com). Never retype them in a
  component.
- **The chat is "our team", and each message names its sender** (29 October
  2026, as Kyle takes on staff). The Messages page, the Home tile, the chat
  bubble and Quick answers say "our team"; every team message shows its
  sender's FIRST name from `staffNames()` (`src/lib/staff.ts`, service role,
  first names only, "Hartwell Digital" for an account with no name). The same
  first name goes on phone pushes and, from migration 0061, on the "New message
  from" email. The Welcome page shows the logo (`public/images/hd-logo.webp`,
  the website's black logo) rather than Kyle's photo. The Home contact card
  and a few page descriptions still name Kyle, deliberately, until he says
  otherwise.

## Client onboarding (0055)
- `/welcome` is where a new client starts: Kyle's photo (the website's real
  headshot, `public/images/kyle.webp`) and welcome note, what happens next, and
  the onboarding form a section at a time, saved as they type. Home links
  there ("Start here" plus three tappable steps) until it is sent.
- **The questions live in `src/lib/onboarding-shared.ts`**, and the answers in
  one JSON document per client (`onboarding.answers`), so changing a question
  needs no migration. Add a new key rather than renaming one, or old answers
  are lost. `saveOnboarding` drops anything not shaped like an answer.
- **Never ask for passwords.** The access section has clients add
  admin@hartwelldigital.com to each platform and tick it off.
- Sending it needs business, goals and brand; access and the kickoff call can
  follow. The first send notifies Kyle (type `onboarding`) and puts "Review
  <client>'s onboarding" on his dashboard with a four-step checklist, keyed
  `onboarding:<client_id>` so the open-item index stops a duplicate. Sending
  again only notifies.
- The kickoff call uses Kyle's booking link from Settings ("New client
  onboarding", its own update so a database without 0055 refuses only that).
  "I've booked it" is the client's word for it, recorded once.
- **New means recent.** Home treats a client as new only within 60 days of
  joining (`ONBOARDING_WINDOW_DAYS`) or while onboarding is part done, so a
  long-standing client is never greeted as a newcomer.
- Kyle reads the answers at `/admin/clients/[id]/onboarding` (the Onboarding
  button on each client card).

## Content approval board (0054)
- **Kyle posts work, the client signs it off, in the portal.** Four kinds:
  website copy, designs, social posts, ads. `approvals` (status draft, waiting,
  changes, approved; `round` is the version), `approval_files` (in
  `pulse-reports` under `<client_id>/approvals/<id>/`, so the existing bucket
  policies let the client read their own and only Kyle write) and
  `approval_events` (sent, approved, changes, comment).
- **A client only ever READS through RLS**, and only sent work (status not
  draft). Approve, ask for changes and comment are server actions in
  `src/app/(client)/approvals/actions.ts` that check the work is theirs and
  waiting, then write with the service role. The decision update is filtered on
  `status = 'waiting'` as well, so a double tap or two people deciding at once
  records one decision. Asking for changes requires a sentence.
- Sending again after changes is the next version (`round + 1`). Notifications
  go on the `instant` channel with type `approval`, so the 15-minute email job
  emails them: everyone on the client account when Kyle sends or comments,
  Kyle when the client decides or comments. A note on a draft tells nobody.
- Files go browser to storage, then `addApprovalFile` checks the path is one
  level inside that approval's folder and reads the real size back; a refused
  file is deleted again. `ApprovalContent` lays each kind out as it will be
  used (copy as a page, a post as a post, an ad as an ad) and is the SAME
  component on both sides, so Kyle's preview is what the client sees.
- No confetti on the client's Approve: celebrations are admin only.
- The client's Copy tab only shows if they have copy documents
  (`hasCopy` on Shell); new work goes through approvals.
- **Google Drive folders (0053) were built and retired on 28 October 2026**,
  never connected: Kyle chose to keep everything in the portal. 0054 drops the
  tables if they were created. The code is in git history (807e0b9) should it
  ever be wanted.
- Reports: the client list leads with the latest report; "Download PDF" goes
  through `/reports/[id]/pdf`, which checks the report through RLS and then
  redirects to a one-minute signed URL. It only falls back to printing when no
  PDF has been generated.

## Look and feel: the website's, on purpose
- **Clients should feel they are still on hartwelldigital.com.** Same palette
  (the site's gold, #0e0d0b dark, #f9f7f2 light), same Outfit, and since 28
  October 2026 the same typography and blocks. The site lives in
  `../hartwell-digital-v6_21/hd-v5` (CSS in `css/global.css`, section styles
  inline in each page); read it before inventing a new treatment.
- Page titles are heavy uppercase with the LAST word in gold (`PageHeader`
  does it; a one-word title stays plain), over a fading `gold-rule`.
- **NO EYEBROWS. Ever.** No short, small, spaced-out uppercase label directly
  above a heading. Kyle had all of them removed from the website on 19 October
  2026 because they read as AI-generated, and a first pass at the portal look
  on 28 October put them back before the site's changelog was read; they came
  straight out again. A card's heading is `.card-title` (heavy, uppercase, in
  the text colour, like the site's service-card titles) and stands alone;
  context goes beside or below it. Stats put the NUMBER first and the label
  under it, as the website's stat blocks do. Check by rendering the page and
  looking for the device, not by grepping a class name: the website's own
  removal missed ten that way.
- `.mono-label` kept its name but is Outfit now, not monospace. `.data-mono`
  stays monospace for figures.
- Buttons are square (2px), uppercase, spaced, and the gold one rises with a
  glow. Clickable cards take `.lift`: a springy rise, gold border and a gold
  line sweeping across the top, drawn by the card's own `::before` so no
  `overflow: hidden` is needed. Never put `transition-colors` on a `.lift`
  element: utilities win and the rise would snap instead of spring.

## Portal shell
- **Cmd+K** opens `CommandPalette`, mounted in `Shell` for both variants. With
  no query it lists the nav; typing hits `searchEverything()`. That action is a
  flat sweep with NO role branching on purpose: it runs on the RLS client, so a
  client account gets their own rows and `leads` returns nothing. Adding a
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

## The 3D HD logo (30 October 2026)
- **Kyle asked for the Hartwell Digital "HD" monogram turning in 3D**, polished
  gold with a sparkle, after a liquid-chrome reference video: large on
  `/sign-in` and `/welcome-in` (`<HdMark size={112} />`), small at the top left
  of every portal page (`<Wordmark mark="hd" />` in `Shell`: sidebar, phone
  header, phone menu). Printed documents keep the flat pulse glyph.
- **The only master of the logo is raster** (the website's
  `images/logo-mark.png`). `src/lib/brand/hd-path.ts` is a potrace of it,
  checked by rendering it back over the original (99.5% of pixels agree). It is
  one closed outline; the slivers between the H and the D are part of it, so
  never thicken the outline (no stroke, no outward bevel).
- `HdMark.tsx` paints a flat SVG of the mark first (server rendered, colours
  in `--hd-*` tokens fitted to the 3D's resting frame), then lazy-loads
  `src/lib/brand/hd-mark-scene.ts` (three.js r170, its own chunk, about 155 KB
  gzipped, fetched only when the mark is on screen and the browser is idle) and
  fades the canvas in over it. The flat mark stays for reduced motion, no
  WebGL2, or a GPU that keeps dropping the context.
- **It turns, then rests**: the sidebar and phone marks play one turn after
  mounting and one more on each navigation or when the pointer comes onto the
  lockup; the sign-in hero plays five (30 s). Resting, it draws nothing. Kyle
  asked for it "playing"; this is the recommended reading of that (motion that
  never stops at the edge of a client's eye all day is the likely complaint,
  and WCAG 2.2.2 wants auto-motion to stop). `turns={Infinity}` makes one loop
  forever if he wants that.
- The scene is a pure function of time (`render(t)`, periodic), built from a
  signed distance field of the outline (the rounded "pillow" edges), a
  shader-painted studio through PMREM, its own alpha-correct bloom, and star
  glints aimed at real highlights. Designed and reviewed in a scratch
  prototype over two review rounds; the scene file's header explains the rest.
- **The phone header drops the words under 380 px** (`max-[379px]:sr-only`):
  with the monogram and "HARTWELL PULSE" side by side, a 375 px iPhone scrolled
  sideways. It was already 1 px over at 360 px before the logo went in.

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

## Sales pipeline (0056)
- **The old outreach CRM was deleted on 28 October 2026**, at Kyle's request:
  he had never used it. Every `crm_*` table and function went, with the
  Ironpeak pipeline data, the Outlook drafting cron (`crm-send`), the
  `crm-reminders` cron and the Graph client. 0056 copies everyone who opted out
  or was marked do not contact into `do_not_contact` FIRST, then drops the rest.
  The code is in git history before the Stage 5 commit.
- **`do_not_contact` is kept for good.** An opt-out is honoured forever, not
  until the next clear-out. `email_lower` is generated and unique. Adding a lead
  checks it and warns, the lead page shows it, and Kyle adds people at
  `/admin/pipeline/do-not-contact`.
- `/admin/pipeline` is Follow up today first, then a board of New, Contacted,
  Meeting and Proposal (drag a card between columns), then Won and Lost. Every
  open lead carries `follow_up_on`, tomorrow by default. Due and overdue ones
  show on the dashboard strip, and the work generator makes an item keyed
  `lead:<id>:<date>`. Logging a call, email or meeting on a New lead moves it to
  Contacted, because that is nearly always what happened.
- **Won is never a drag.** `moveLead` refuses it. The only way in is "They said
  yes" on the lead (`onboardLead`), so a won lead always has a client behind it.
- **"They said yes" does it all, and reports each step**: create the portal
  passwordless (`provisionClient` in `src/lib/provision.ts`, shared with Add
  client), start onboarding, send the welcome email (`src/lib/welcome-emails.ts`)
  with a one-click sign-in button, leave a welcome in their chat (its
  notification marked emailed, so day one is one email, not two), book the day
  3 and day 7 check-ins in `scheduled_emails`, and mark the lead won. Only the
  first step can stop it; a missed email is reported so Kyle can send it by
  hand. It celebrates, admin side only.
- **The one-click button is a Clerk sign-in token**, single use and valid seven
  days, landing on `/welcome-in` (public in middleware), which swaps it for a
  session and goes to `/welcome`. Nobody is sent a password. `SetPasswordCard`
  on Home and `/welcome` asks them to choose one for next time while
  `passwordEnabled` is false. If Clerk refuses the passwordless create,
  provisioning falls back to a temporary password and the dialog shows it, so a
  client is never left with no way in. **Not yet proven against live Clerk as of
  28 October 2026**: check the first real welcome link signs in.
- The check-ins go out from the 15-minute `/api/cron/email` job. Each row is
  CLAIMED (sent_at set where still null) before it sends and handed back if the
  send fails, because an email cannot be taken back. Day 3 thanks them if
  onboarding was sent and nudges if not. A check-in more than three days late is
  dropped, and so is one for someone no longer on the account.
- **Website enquiries arrive by themselves.** The site's `/api/enquiry` and
  `/api/quiz` post to `/api/webhooks/lead` AFTER Kyle's own email has gone,
  through `waitUntil` (website `lib/pulse.js`), so the portal can never lose or
  delay a lead. The route fails CLOSED without `LEAD_WEBHOOK_SECRET` in Vercel,
  which must equal `PULSE_LEAD_SECRET` in Cloudflare Pages. Likely spam stays off
  the board. A second enquiry from someone with an open lead becomes a note on
  it, not a second card. A new enquiry is due today.
- **Each website lead alerts Kyle** (0060 adds the `lead` notification type): a
  bell notification on `in_portal`, because the website has already emailed him
  and a second email would be noise; a desktop pop-up while the portal is open
  (the bell pops up `message` and `lead`); and a push to every device he has
  switched on with "Turn on notifications" on Messages, opening the lead. A
  repeat enquiry alerts too. Likely spam never does. Leads Kyle or Claude add
  themselves do not alert anyone.

## Claude connector (0057)
- **Claude works the pipeline from Kyle's own chats** through an MCP server at
  `/api/mcp`, added in Claude as a custom connector (the address is on
  Settings). Hand-written JSON-RPC over Streamable HTTP, one JSON reply per
  request, no SSE and no session: initialize, ping, tools/list, tools/call.
- **The portal is its own OAuth 2.1 server for this one resource**
  (`src/lib/mcp/oauth.ts`). Claude discovers it from
  `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server`, registers at `/api/oauth/register`
  (or names a Client ID Metadata Document, fetched ONLY from claude.ai,
  claude.com or anthropic.com), sends Kyle to `/oauth/authorize`, and swaps the
  code at `/api/oauth/token`. Authorization code with PKCE S256 only.
- **An approval can only ever go back to Claude or localhost.** Registration
  refuses any other redirect, and the consent page re-checks it. An unknown app
  or a wrong redirect is shown an error and never redirected, as OAuth says.
- `/oauth/authorize` is NOT public: signed out means sign in first. Only an
  admin is asked. Allow is a server action that re-checks everything (the form
  is only what the browser sent back), and `next.config.mjs` forbids framing
  `/oauth/*` so a disguised button on another site cannot collect Kyle's Allow.
- **Tokens are random strings stored as SHA-256 hashes** (0057's three tables
  are RLS on with no policies: service role only). Access tokens last an hour
  and are bound to `<origin>/api/mcp`; refresh tokens last 90 days and rotate on
  every use. A code used twice, or a spent refresh token replayed more than a
  minute after rotation, revokes the whole family: that is what a stolen copy
  looks like. Every MCP call and every refresh re-checks the person is still an
  admin in `client_users`.
- **What Claude may do is drawn at what reaches a person or cannot be undone**
  (`src/lib/mcp/pipeline-tools.ts`): read, add, update, move, log, check the
  do-not-contact list. It cannot mark a lead won (that creates a portal and
  emails a welcome), delete, or email anyone. Writes go through
  `src/lib/pipeline-ops.ts`, the same functions as the portal's own buttons,
  with `created_by = 'claude'`. Bad input comes back as a tool error the model
  can read, never a crash.
- Settings lists what is connected and Disconnect revokes every token that app
  holds, effective on its next request.

## Client feedback, NPS (0058)
- One question, 0 to 10, "How likely are you to recommend Hartwell Digital to
  a friend or colleague?", then an optional reason. Asked of every person on a
  client account 30 days after the client started (onboarding sent, else the
  day they were added), then 91 days after each round. Paused and deleted
  clients are skipped. The rules are pure, in `src/lib/nps-shared.ts`.
- **Off until Kyle switches it on** (Settings, Client feedback,
  `business_settings.nps_enabled`). Deploying it emailed nobody. The Feedback
  page says who the first morning would reach while it is off.
- `/api/cron/nps` runs weekday mornings (22:30 UTC Sunday to Thursday), raises
  the round and emails it. One round per person per date (unique index), so a
  second run asks nobody twice, and no email goes without its row.
- **The email's number buttons only open `/nps/<token>?s=N` with that number
  picked; nothing is saved until Send.** Mail scanners (Outlook Safe Links and
  the like) follow every link in a message, and a link that recorded a score
  would answer for the client. The token is the credential, stored hashed;
  `/nps/(.*)` is public in middleware.
- The same question sits on the client's Home while it is open (21 days), read
  through RLS (own rows only). "Not now" hides it for that visit. Answers are
  written by server actions with the service role after an ownership check,
  conditional on no answer yet, so the first answer stands.
- **A score of 6 or under emails Kyle at once** (direct send, plus a bell
  notification on `in_portal` so the email job does not send a second). Other
  scores go out through the instant channel as usual. A 9 or 10 is shown Kyle's
  Google review link if he has saved one.
- `/admin/feedback`: the score over 12 months (promoters minus detractors, -100
  to +100), the counts, response rate, the trend by quarter, and every answer
  with its reason.

## The assistant and the AI employee (0059)
- **Two models, through `src/lib/ai/claude.ts` and the official
  `@anthropic-ai/sdk`.** Built on Opus 5.5, then split on 28 October 2026 at
  Kyle's request to spend less: clients' Quick answers on **Haiku 5.5**
  (`claude-haiku-5-5`, under a tenth of a cent a question) and Kyle's drafts on
  **Sonnet 5.5** (`claude-sonnet-5-5`, where his voice matters). Haiku 5.5 has
  no server-side refusal fallback, so its requests must not send `fallbacks`
  (a list is a 400); a decline gets the "message Kyle" reply. The drafts opt
  into `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Effort
  is `low` on both: short answers. Thinking counts toward `max_tokens`. Never
  send Sonnet 5.5 `thinking: {type: "disabled"}` (400) and never force
  `tool_choice` (400). Needs `ANTHROPIC_API_KEY` in Vercel; without it every AI
  feature says plainly that it is not set up.
- **Quick answers** is the second tab in the client's chat bubble, shown only
  when Kyle has switched it on in Settings AND the key is set. It streams from
  `/api/assistant` (a route, not an action: ten seconds is not enough).
- **It only ever sees three things** (`src/lib/assistant.ts`): the portal guide
  written there, Kyle's notes from Settings, and a summary of this client's own
  account. Facts, not figures: invoice amounts are deliberately never put in
  front of it, nor anything about another client. What it was never given, it
  cannot leak. Keep it that way when adding account facts.
- Prices, quotes, changes to services, invoice problems, complaints and
  anything it cannot answer go to Kyle through its one tool, `pass_to_kyle`: a
  bell notification (`in_portal`, so no extra email) and the reply marked
  "Passed to Kyle". The question is saved before Claude is called, so Kyle sees
  it even if the call fails.
- **One email per conversation**, sent by the 15-minute email job once the
  conversation has been quiet for ten minutes, with every question and answer
  ("Needs you:" in the subject if anything was passed over). Claimed before
  sending. A question after that email starts a new conversation, so nothing is
  sent twice. A 30-minute gap also starts a new one.
- 30 questions per person per day, 1,000 characters each.
- **The AI employee drafts, never sends.** A sparkle button in Kyle's chat
  composer (`/api/ai/draft-reply`) puts a suggested reply in the box for him to
  edit; "Follow-up email" on a lead (`/api/ai/draft-follow-up`) drafts a subject
  and body for his own mail app. It refuses anyone on the do-not-contact list.
  Missing facts come back as [placeholders], not inventions.
- `/admin/assistant` shows every conversation and what was passed over.

## Ironpeak
- Ironpeak Consulting is a **registered business name against Hartwell Digital's
  ABN 44 286 503 049**, trading in defence only. Internal surfaces may say
  Hartwell is the parent; **client-facing output must not**: no "a business of
  Hartwell Digital", no dual logos. The bare ABN line is the only permitted
  expression of the parent. Invoices and reports carry it through `brand`.
- **Do not resume Ironpeak cold outreach.** In August 2026 programmatic sends
  through Microsoft Graph drew `550 5.7.708` rejections and the Microsoft 365
  tenant was then blocked (`TenantAccessBlockedException`). The drafting
  pipeline went with the CRM. `MS_GRAPH_*` and `IRONPEAK_SEND_FROM` in Vercel are
  unused now, and the cron-job.org job for `/api/cron/crm-send` should be
  deleted (the route is gone).

## Income (admin)
- `/admin/income` works Kyle's income out of his invoices with nothing to
  enter. The rules live in `src/lib/income-shared.ts`, pure and tested: a paid
  invoice counts in its Melbourne paid month for total less deposit; a
  credited deposit counts in the invoice's issue month; split parents never
  count (`isSuperseded`), their instalments do; drafts, voids and recurring
  templates are not income. Retainers are the active recurring templates.
  Financial year is 1 July to 30 June, compared with last year to the same day.
- If deposits are ever billed as invoices of their own, the deposit rule
  counts them twice. That is the line to change.

## The dashboard: work items
- **Everything Kyle owes anyone is a `work_items` row.** The dashboard used to
  read `board_cards` and nothing else, which is why it went unused: the work
  lived in the CRM, the invoices and the reports and none of it reached the
  page. Design and reasoning in `docs/dashboard-spec.md` (0044, 0045).
- **A tick may never fabricate a record with financial weight.**
  `completeWork` REFUSES an `invoice` and says where to go instead: paid means
  money arrived, and that is not decided by a checkbox among twelve others.
  Everything else closes.
- **The partial unique index is the whole design.**
  `(source_kind, source_key) where state = 'open'` lets the generator run
  hourly and never make a second open item. The key carries a STAGE, not a row:
  `invoice:<id>:overdue7` and `:overdue30` are different work, which is how
  Not doing suppresses one nag without suppressing the invoice forever.
- **Overdue asks once.** Seven days unanswered raises a question with a button;
  answering sets `asked_at` and it never returns. That is the difference from
  the notification it replaced, which asked every morning and could only be
  read.
- **One notification a day for Kyle's own work**: `/api/cron/brief` at 21:00
  UTC, which is 7am Brisbane, and it stays silent when nothing is due. Client
  triggered notifications are untouched, because those are someone waiting.
- A recurrence per client is the answer to "what counts as a retained client":
  nothing infers it, Kyle sets one up once and it becomes a fact.
- `board_cards` is migrated into work items by 0044 and deliberately NOT
  dropped. It goes when the new page has been used in anger for a while.

## Celebrations and gamification
- Admin surfaces only. Clients are businesses and defence buyers are
  conservative, so confetti in a client portal would read as unserious.
- `celebrate()` in `src/lib/celebrate.ts` fires on OUTCOMES, never activity:
  a client won ("They said yes"), an invoice marked paid. **Never celebrate a
  send.** Sending an invoice gets nothing; being paid does.
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
