# Hartwell Pulse — what the portal actually does

Product feature reference, written 2 September 2026 against deployed commit `2dd379a`.
194 TS/TSX files, roughly 31,000 lines, 46 SQL migrations.

This document exists because the machine holding the build history died and the
reasoning went with it. It is written to be loaded by a future AI session as
shared operating context, and read by Kyle. Everything here was checked against
the code, not remembered. Where a claim could not be verified it says so.

Companion documents:

| File | What it covers |
|---|---|
| `CLAUDE.md` (repo root) | The rules. Hard-won constraints, real incidents, things not to undo |
| `docs/dashboard-spec.md` | Why the admin dashboard is a work system, and the sixteen decisions behind it |
| `docs/FEATURES.md` (this file) | What the portal does, per audience, per area |

---

## Facts established 2 September 2026

Two things were verified on that date and supersede anything older.

**All 46 migrations (0001 to 0046) are applied in production.** This was proved
by probing the live database for the signature table or column of each
migration: 34 probes, 0 missing. `CLAUDE.md` still carries an older, weaker
note saying only 0035 to 0041 were confirmed and everything below was assumed.
That note is superseded. Applied state is still not tracked anywhere, so a
future migration must still be probed for rather than assumed, but nothing in
0001 to 0046 is in doubt.

**Email attachments exist in exactly two places**, and both were read to
confirm it:

| File | What it attaches |
|---|---|
| `src/lib/invoices-send.ts` | The invoice PDF on the send, the resend and the test send |
| `src/lib/reports-send.ts` | The report PDF on the send and the test send |

Nothing else attaches anything. In particular, the due-soon heads-up and the
overdue nudge in `src/app/api/cron/overdue/route.ts` send HTML plus a portal
link and no PDF. A client who cannot open the portal gets the original invoice
email with a PDF, then two kinds of reminder with nothing to pay from. Recorded
as a known gap, repeated in "Risks and gaps" at the end.

---

## 1. Who can be in here, and what they see

There are exactly two roles, resolved from a `client_users` row keyed on the
Clerk user id (`src/lib/auth/session.ts`).

| Role | Home | Scope |
|---|---|---|
| `admin` | `/admin` | Everything, across every client, plus the CRM |
| `client` | `/dashboard` | Their own client account only, enforced by RLS |

A Clerk user with no `client_users` row is signed in but unmapped, and lands on
a holding page at `/` saying their account is being set up
(`src/app/page.tsx`). There is no public sign-up: Kyle provisions every login.

A lookup failure on `client_users` throws rather than degrading to
"unprovisioned", deliberately, so a bad service key or an RLS misconfiguration
fails loud instead of quietly turning everyone into a stranger.

**Route map.**

| Client route | Admin route | Area |
|---|---|---|
| `/dashboard` | `/admin` | Dashboard (they are completely different pages) |
| `/reports`, `/reports/[id]` | `/admin/reports`, `/admin/reports/[id]`, `/admin/reports/[id]/preview`, `/admin/reports/new` | Reports |
| `/assets` | `/admin/assets` | Files |
| `/copy`, `/copy/[id]` | `/admin/copy`, `/admin/copy/[id]` | Copy documents |
| `/website` | `/admin/clients` (Preview links dialog) | Website previews |
| `/messages` | `/admin/messages` | Messaging |
| `/invoices`, `/invoices/[id]` | `/admin/invoices`, `/admin/invoices/[id]`, `/admin/invoices/new` | Invoices |
| — | `/admin/clients`, `/admin/clients/[id]/preview` | Clients |
| — | `/admin/crm`, `/admin/crm/[orgId]`, `/admin/crm/plan` | CRM and outreach |
| — | `/admin/work/recurring` | Recurring work |
| — | `/admin/settings` | Business details and pricing |

Public or semi-public routes, exempted from Clerk in `src/middleware.ts`:
`/sign-in`, `/api/webhooks/*`, `/api/cron/*`, `/unsubscribe/[token]`, and
`/print/*`. Each exemption is path-anchored with a trailing slash so a sibling
like `/api/cron-foo` is not exempted along with it. `/share/[token]` is NOT
exempt: a share link still requires a portal login.

**Navigation.** `src/lib/nav.ts` holds both nav lists. The client has seven
items, the admin nine. The client's **Website** tab only appears when that
client has at least one visible preview page, counted in
`src/app/(client)/layout.tsx`; on a six-item nav a permanently empty tab is a
sizeable fraction of it. On mobile the client gets a bottom tab bar; the admin
gets the drawer only.

**Losing access.** A soft-deleted client keeps every byte of their data but
loses the portal immediately: the client layout renders "Your portal access has
ended" rather than the shell.

---

## 2. The admin dashboard: work items

`/admin`, built on `work_items` (migrations 0044 to 0046). The full reasoning
is in `docs/dashboard-spec.md`; this is what it does.

**Everything Kyle owes anyone is a row of the same shape.** The old dashboard
read `board_cards` and nothing else, which is why it went unused: the actual
work lived in the CRM, the invoices and the reports, and none of it reached the
page.

### The strip

Six live numbers across the top, each a link (`src/components/work/WorkStrip.tsx`,
counted in `getWorkStrip` in `src/lib/work.ts`): Owed, Overdue, Sends this week,
Reports in draft, Snoozed, Open. Each is counted from the system that owns it,
not derived from whether a work item happens to exist, so the money owed is
right even if the generator has not run.

### Four views over one list

Tabs on the same rows (`src/components/work/WorkDashboard.tsx`):

- **Today** answers "what next". Overdue first with an age, then today, then
  later this week, then Someday (no date). Only Today is draggable; a drag
  writes `position` for the whole visible group.
- **Board** is three derived columns: Now (overdue and today), Next (dated,
  further out), Someday. The column IS the date, so a card's state and its due
  date can never disagree.
- **Calendar** is a fortnight, day by day. A month view of a solo operator's
  work is mostly empty squares.
- **Done** shows the last 50 closed rows, done and dropped side by side with
  their reasons, and a "Put it back" on each. This exists because ticking
  something used to make it vanish with no way back from a mis-click.

### Every row has three buttons

Done, Snooze, Not doing (`src/components/work/WorkItemRow.tsx`, actions in
`src/app/admin/work/actions.ts`).

**The rule a user will trip over: a tick may never fabricate a record with
legal or financial weight.** `completeWork` REFUSES two source kinds and says
where to go instead:

| Source kind | Done does |
|---|---|
| `crm_send` | Refused. "Sends are logged where they happen." The touch log is the Spam Act defence |
| `invoice` | Refused. "Invoices are marked paid on the invoice, not here" |
| `crm_task` | Closes the item AND stamps `crm_tasks.done_at`, because a LinkedIn connect is harmless and reversible |
| everything else | Closes the item |

Snooze offers tomorrow, in 3 days, next week. Snoozing also clears `asked_at`,
because answering "yes, later" is a fresh decision and the question may return.
Snooze is evaluated on read (`isSnoozed`), never by a job that flips state back,
so a snooze cannot be lost to a cron that did not run.

Not doing drops the row with an optional one-line reason. It is dropped, not
deleted, so "why is this not in the list" has an answer six weeks later.

An expanded row also carries: an editable title and date (the edit keeps an
existing clock rather than silently moving an 08:47 send to midnight), a
checklist of steps with a "3 of 6" progress read, logged hours with a note
(after the fact, no timer, because a running clock is a thing to forget to
stop), and a link to the source record.

### Where the items come from

`src/lib/work-generate.ts`, run hourly by `/api/cron/work`. Every insert is
guarded by a partial unique index on `(source_kind, source_key) where state =
'open'`, so running it hourly makes nothing twice. Error code 23505 is the
mechanism, not a fault.

**The key carries a STAGE, not a row.** `invoice:<id>:overdue7` and
`invoice:<id>:overdue30` are different work about one invoice, which is how
"Not doing" suppresses one nag without suppressing the invoice forever.

| Source | Stages generated |
|---|---|
| Invoices (status `sent`) | `:soon` (3 days out), `:due` (on or past the day), `:overdue7`, `:overdue30` ("worth a phone call rather than another email") |
| Reports in `draft` | `report:<id>:draft`, "Finish and send ..." |
| Ironpeak CRM sends | Only where `send_approved_at` AND `scheduled_send_at` are set and stage is queued, contacted or bounced. Carries `has_time`, because 08:47 is the point |
| CRM tasks | Any `crm_tasks` row due today or earlier and not done |

An unapproved CRM record is deliberately not work yet: it is a decision Kyle
has not made. That also means the blocked Microsoft tenant suppresses these on
its own.

### Recurring work

`/admin/work/recurring` (`src/components/work/Recurrences.tsx`), materialised
by `src/lib/work-recurrence.ts`. Weekly, monthly, quarterly or annual, with a
`lead_days` head start and a checklist stamped out each time. `last_made_on` is
the dedup.

**A recurrence per client IS the declaration that a client is retained.**
Nothing infers it from services or invoice history, because an inference would
be wrong about exactly the accounts mid-change, and wrong silently. Pausing a
recurrence (`active = false`) keeps the checklist, which deleting would lose.

---

## 3. The client dashboard: metrics

`/dashboard` (`src/app/(client)/dashboard/page.tsx`,
`src/lib/dashboard.ts`). Six months of `metrics` rows for the signed-in client,
grouped by service.

- Up to five headline stat cards across the top, deduped by metric key so a
  metric spanning two services does not appear twice.
- A collapsible section per enabled service, with a sparkline of the lead
  metric and a grid of the rest.
- Every figure carries a delta badge against last month.

**The non-obvious part is direction.** `src/lib/metrics.ts` knows which way is
good for each metric, so a falling cost per lead reads green and a rising
bounce rate reads red. Anything not in `METRIC_META` falls back to neutral and
still renders.

Empty state: "Your metrics land here soon". There is no metrics import UI in
the portal, so metrics arrive by some route outside it (see Open questions).

Kyle can see exactly this page for any client at
`/admin/clients/[clientId]/preview`, with a gold banner saying so.

---

## 4. Clients, client users and website previews

All admin only, at `/admin/clients` (`src/app/admin/clients/actions.ts`).

### Provisioning a client

"New client" takes a business name, contact name, email and service tier, and
in one step creates the Clerk login, the `clients` row (status `onboarding`,
with a uniquified slug) and the `client_users` mapping. It returns a one-time
random password for Kyle to hand over.

Backend-API email addresses are auto-verified, so the client can sign in
immediately with no verification email to chase. If either database write
fails, the just-created Clerk user is deleted so a retry starts clean rather
than leaving an orphan login.

### Adding another person to an existing account

"Users" on a client card. Same flow, same one-time password. They get their own
login and their own private thread with Kyle, and share everything
client-scoped: assets, invoices, reports, copy, previews.

### Reissuing a password

"Users", then the key icon. Rewrites the Clerk password to a fresh random one,
signs out every other session, and hands Kyle the string to pass on however he
likes.

This is deliberately NOT a "send a reset email". A reset link is one more email
to be missed by the person who already missed one, and it cannot be read out
over the phone. It refuses to touch an admin: an admin who could silently
rewrite another admin's credentials from a button is a different security
model.

### Changing a login email

Adds the new address to Clerk as verified and primary FIRST, then removes the
old ones, then updates `client_users`. That order can never leave an account
with no login email. Password and sessions are untouched.

### Lifecycle

| Action | Effect |
|---|---|
| Make inactive (`status = 'paused'`) | Organisational only. No data touched, login unchanged, recurring billing skips them |
| Delete (`deleted_at`) | Hidden, portal access cut immediately, restorable for 30 days |
| Restore | Undoes the soft delete, within the window |
| Purge (automatic, day 31) | `/api/cron/purge-clients` deletes portal data and the Clerk logins |

**Invoices are never purged.** `purge-clients` deliberately never touches
`invoices` or `invoice_line_items`, and keeps the `clients` row itself as a
named invoice anchor, stamping `purged_at` and parking the status. Every delete
in the purge uses `.throwOnError()`, so a failure leaves `purged_at` null and
the client is retried next run rather than left half-purged and silently
skipped forever.

Purged clients are filtered out of `/admin/clients` entirely.

### Website previews (migration 0041)

The "Previews" dialog on a client card
(`src/components/admin/ClientPreviewsDialog.tsx`), shown to the client at
`/website` (`src/components/preview/SitePreview.tsx`).

Named pages, in order, each with an optional note about what to look at. It
replaced a staging URL pasted into a chat message, which meant the client
hunting for the most recent one and never knowing whether it was still current.

- Many rows per client on purpose. A site is not one page, and "have a look at
  the services page" is the normal request.
- Rendered in a sandboxed iframe, not screenshots: a screenshot is stale the
  moment it is taken and the point is watching something change.
- Desktop, tablet (768px) and mobile (390px) widths, because how it looks on a
  phone is the first question anyone asks about a new site.
- `visible` hides a page rather than deleting it. Not ready to be shown is a
  normal state during a build, and losing the URL each time would be tedious.
  RLS enforces it, not the component.
- Only `http` and `https` URLs are accepted; `savePreview` rejects anything
  else outright.

**The frame can be refused and there is no reliable way to detect it.** A site
sending `X-Frame-Options` or a `frame-ancestors` policy renders blank, and
cross-origin rules stop the parent asking why. So "Open in a new tab" is always
on screen rather than a fallback that appears after a failure nobody can see,
and a line underneath tells the client what a blank panel means.

---

## 5. Assets

`/assets` for clients, `/admin/assets` for Kyle (who picks a client first).
Same component both sides: `src/components/assets/AssetsBrowser.tsx`.

### What both roles can do

- Browse a real folder tree with breadcrumbs. Folders are rows in
  `asset_folders` with a `parent_id`; the tree is fetched whole per client and
  assembled in memory (`src/lib/folders.ts`), because per-client trees are
  small.
- Create, rename, move and delete folders. The move picker refuses a folder's
  own descendants, so a folder cannot be moved inside itself.
- Upload by drag or browse, into the current folder. **50 MB per file**,
  enforced in the browser and again by the bucket (migration 0019) so nobody
  waits out a big upload only to be bounced at the end.
- Open anything in a full-screen viewer with arrow-key navigation: images with
  click-to-zoom, PDFs in an iframe, video with controls, everything else as a
  download card.
- Tag a file: Draft, Approved, Ready to Use, Urgent.
- Move a file between folders from the viewer.
- Comment on a file, threaded per asset, with optimistic insert.
- Create a share link.

### Deleting a folder does not delete files

Files inside move up to the top level (`assets.folder_id` is `ON DELETE SET
NULL`). The confirm dialog says so.

### Thumbnails

Generated in the browser at upload: a 480px WebP at quality 0.8, stored
alongside the original under `{client_id}/_thumb/{id}.webp`. Best-effort, and a
failure is silent. This exists because `next/image` must never sit in front of
a Supabase signed URL (rotating tokens defeat its cache and burn the Hobby
optimiser quota) and Supabase image transforms are Pro-only. Thumbnails are
served as plain lazy `<img>`.

### Permissions (migration 0011)

Two switches, both admin only, both enforced in Postgres rather than in the
component.

| Switch | Where | Effect |
|---|---|---|
| Folder "Make view-only" (`client_editable = false`) | Folder menu, admin only | The client can still SEE and download everything in it. They cannot upload into it, edit it, rename it, move it or delete it |
| Asset "Lock" (`locked = true`) | Viewer, admin only | The client cannot edit tags, move, or delete that file |

SELECT is deliberately untouched by these policies: a view-only folder stays
fully readable. Only client WRITES are gated. Admin and the service role are
never restricted.

**FK cascades do not re-check RLS**, so a `BEFORE DELETE` trigger on
`asset_folders` closes the gap the restrictive policy cannot: a client deleting
an editable parent folder is refused if it would cascade into a view-only
sub-folder or free a locked file.

The client-side effect of a view-only folder is an error message, not a hidden
control: the uploader is always rendered and the write is refused by the
database.

### Share links

`src/lib/actions/shares.ts`, `src/lib/shares.ts`, `/share/[token]` and
`/share/[token]/raw`.

- Created from a folder menu or the asset viewer, by an admin or a client (RLS
  resolves the target, so a caller can only share what they can already see).
- **Expire in 7 days.** That is hardcoded at both call sites; the action
  accepts any number of days but nothing passes anything else.
- The raw token is returned to the caller exactly once, to copy. Only its
  SHA-256 hash is stored.
- The landing page shows the file inline (image, PDF, video) or lists a
  shared folder's files, and counts the view.
- **Every file fetch goes through `/share/[token]/raw`**, which revalidates the
  token and then 302s to a freshly minted 60-second signed URL. A signed URL is
  never written into HTML or email, and revoking a share kills live file
  access, not just the landing page.
- A folder share will only serve a direct child of that folder; a single-asset
  share ignores any `?asset` parameter entirely.
- `resolveShare` fails closed on unknown, revoked, expired and used-up.

**The gotcha: a share link still requires a Pulse login.** Shares are created
with `require_login: true` and `/share/*` is not in the middleware's public
list, so a link sent to someone without an account is a sign-in wall. The UI is
honest about it ("Private, sign-in required"), but it means a share is for
moving something between people who already have logins, not for sending a file
to an outsider.

### Notifications on assets

A client upload notifies every admin in-portal ("New upload from {client}").
An admin upload notifies the client on the weekly digest channel: the bell
lights up straight away, the email waits for Monday, so Kyle dropping in eight
files does not produce eight emails.

---

## 6. Copy documents

`/copy` and `/copy/[docId]` for clients, `/admin/copy` and `/admin/copy/[docId]`
for Kyle. One editor for both: `src/components/copy/CopyEditor.tsx`.

A rich-text document (TipTap with StarterKit) with a toolbar for H1, H2, bold,
italic, bullets, numbered lists and blockquote. It autosaves 1.2 seconds after
you stop typing, and the header shows "Saving…" then "Saved".

**Four statuses**, and the workflow between them:

| Status | Set by | Meaning |
|---|---|---|
| `draft` | on creation | Being written |
| `submitted` | client, "Submit for review" | Handed to Kyle. Also writes a version snapshot labelled "submitted" |
| `approved` | admin, "Approve" | Signed off. Clears any review note |
| `changes_requested` | admin, "Request changes" | Kyle typed a note; the client sees it in a red banner at the top of the document |

**Version history** is a snapshot per submission, not per save. The sidebar
lists up to 50, newest first, each restorable. Restoring replaces the current
text (the current text stays in history because it was itself snapshotted at
the last submission, and the restore schedules a fresh save).

Both roles have the same editing power on the body. The difference is the
buttons: the client gets "Submit for review"; the admin gets "Request changes"
and "Approve", and can draft on the client's behalf.

Non-obvious: creating a document immediately inserts an "Untitled" row and
navigates to it. There is no cancel, so an abandoned new document sits in the
list as "Untitled".

---

## 7. Messaging

`/messages` for clients (`ClientMessages`), `/admin/messages` for Kyle
(`AdminMessages`), both rendering `src/components/messages/ChatThread.tsx`.
Migrations 0017, 0018, 0020, 0021.

### The thread model

| Kind | Members |
|---|---|
| `direct` | One client user plus Kyle. Created by a database trigger when a client user is provisioned |
| `group` | A chosen set of that client's users, plus Kyle. Admin creates it, and must pick at least two |

A client sees only the threads they are a member of. **A teammate's private
thread with Kyle never appears**, enforced by RLS on `conversations` and
`conversation_members`, not by the component.

Group creation validates every supplied member id against that client's real
users, so a stray id can never pull an outsider into a thread. A half-made
group is cleaned up rather than left behind.

Admin can start a direct thread with any client user who does not already have
a live one (a soft-deleted one revives on start), and can create a group for
any client with two or more users. Admin can soft-delete a thread: hidden from
every member immediately, restorable for 30 days, then purged for good by
`/api/cron/purge-clients` along with its attachment files. Soft-deleting also
clears the members' unread message notifications so reminder emails stop.

### In the thread

- **Send** with Enter (Shift+Enter for a newline).
- **Attachments**, one per message, **25 MB max**. Bigger files belong in
  Assets, and the error says so. Images render inline with a zoom and a
  download button; other files render as a link. Downloads are forced with the
  original filename via a 60-second signed URL with `download` set.
- **Paste an image** straight in. Clipboard images arrive named `image.png`, so
  they are stamped `pasted-2026-09-02-14-30-11.png` to keep them tellable
  apart.
- **Emoji**: a picker for the composer (insert into the text at the cursor) and
  a reaction picker per message with six quick reactions (👍 ❤️ 🎉 ✅ 👀 🙏)
  plus a full searchable picker (`src/components/messages/EmojiPicker.tsx`,
  a curated native set, no image assets, no dependency).
- **Reactions** toggle, and are shown as a count pill with your own highlighted.
- **Bare URLs become links**, parsed into elements rather than injected as
  HTML, and `http`/`https` only. A message crosses an account boundary, so
  `javascript:` in something that renders as clickable is not a place to be
  permissive.
- **Search within the conversation**: a magnifier at the top right opens a bar
  with match counts, Enter and Shift+Enter to walk hits, arrow buttons, and
  highlighted matches (message bodies and attachment filenames). Searching also
  releases the scroll pin so the view can pan to a hit.
- **Typing indicators**, broadcast over the realtime channel and never written
  to the database. Throttled to one ping every 2 seconds, expiring 3.5 seconds
  after the last keystroke so a dropped "stop" cannot leave a ghost.
- **Read receipts**. Only the newest of your own messages carries one:
  everything above it is implied read. A direct thread says "Seen"; a group
  says "Seen by Ana, Rob".

**The read receipt only advances when the thread is genuinely being looked
at**: the tab is visible, the window is focused, and the view is pinned to the
newest message. Scrolling up to read history does not count.

Reading a thread also marks that client's unread message notifications read,
which is what keeps the bell honest and stops the 30-minute reminder email.

### Admin-only message actions

- **Edit** your own message. A database guard (migration 0020) stamps
  `edited_at` server side whenever the body changes, so the "edited" tag cannot
  be dodged. Clients have no update policy on messages at all.
- **Delete for everyone.** Attachment files are removed from storage;
  reactions cascade away.

### Unread indicators

Three separate mechanisms, doing different jobs:

| Indicator | Source | Where |
|---|---|---|
| Nav badge on Messages | `unread_message_counts` RPC, per-thread `last_read_at` | `UnreadMessagesBadge`, sidebar and mobile tab bar |
| Tab title `(3) Hartwell Pulse` and a badged favicon | Unread `notifications` count | `TabUnreadBadge`, mounted once in the shell |
| Bell dropdown | The 20 newest `notifications` | `NotificationBell` in the header |

The nav badge counts real unread messages, not bell notifications, so it clears
the moment a thread is read and never counts a teammate's private thread.
Realtime pushes it up instantly and a 15-second poll reconciles throttled tabs.
The favicon badge also drives the PWA app badge where the browser supports it.

### Push notifications

`src/lib/push.ts`, `src/lib/actions/push.ts`, `public/sw.js`, migration 0021.
Both roles get the same "Notifications" toggle on their messages page
(`PushToggle`).

- **Per device by design**, so Kyle's phone can buzz while his desktop stays
  quiet.
- iOS only exposes web push once the site is added to the Home Screen; the
  toggle detects that and says so rather than reading as unsupported.
- The push for a message is fired by the sender immediately after the insert
  (`notifyNewMessage`), so it lands whether or not the recipient has the portal
  open. Everything shown is read back from the database from the message id
  alone, so a preview cannot be spoofed, and only the sender can trigger their
  own message's push.
- A push failure never holds up the thread: it is fire and forget.
- Dead subscriptions (HTTP 410 or 404) are deleted on the spot.
- One notification per conversation `tag`, so a second message replaces the
  first rather than stacking five for one thread.
- "Send me a test" reports precisely which step failed, because "no devices"
  and "server not configured" look identical from the browser and need opposite
  fixes.
- The service worker does push and nothing else. No offline caching: the portal
  is always live data and a stale cache would be worse than a spinner.

---

## 8. Invoices

Admin builds at `/admin/invoices/[invoiceId]`
(`src/components/invoices/InvoiceBuilder.tsx`); the client reads at
`/invoices/[invoiceId]`.

### Statuses and what each locks

| Status | Editable | Deletable | Notes |
|---|---|---|---|
| `draft` | yes | yes | Not visible to the client at all |
| `sent` | **yes** | no | Corrections are the ordinary fix. Can be marked paid or voided |
| `paid` | no | no | Closed record. Can be reopened to `sent` |
| `void` | no | no | Closed record, kept for the number and the audit trail |

**Sent invoices are never hard-deleted, only voided**, which keeps the number
and the trail (ATO five-year record keeping). Voided invoices are tucked into
their own collapsed section out of the main list and the status filters.

Both the paid/void lock and the drafts-only delete are enforced in
`saveInvoice` and `deleteInvoice` server side, not only in a disabled button.

### Building one

"New invoice" picks a client and creates a draft with the business default
terms and GST mode, a number from the `next_invoice_number()` sequence, and
**the recipients of that client's last non-void invoice**. Billing a two-person
account usually means billing the same one of them each month, and having to
remember that every time is how the wrong person gets an invoice.

On the invoice itself:

- **Issue and due dates.**
- **Issued under**: Hartwell Digital or Ironpeak Consulting. Ironpeak renders as
  a light document in Ironpeak's own typography, with the bare ABN line and no
  mention of Hartwell Digital. Same invoice number sequence: one business, one
  set of books.
- **Line items**, each with a title, an optional description, quantity and unit
  amount. Add a blank line, add from the pricing catalogue, or add a
  **Discount**.
- **Discounts are negative line items.** Enter the unit amount as, say, -500.
  They show in the table AND net into a single Discount row in the totals, and
  the discount is capped at the subtotal so a total can never go negative
  (`computeTotals` in `src/lib/invoices-shared.ts`).
- **Deposit received** plus a label. Credited against the total, so the document
  shows the full contract value and then the amount left to pay.
- **GST**: add 10% (heads the document "Tax Invoice"), prices include GST, or
  no GST (heads it "Invoice"). See Risks: the code default is "add", and Kyle
  is not GST registered.
- **Notes** to the client.
- **Send to**: the recipient picker.
- **Email message to client**, with `{client}`, `{invoice}`, `{amount}` and
  `{due date}` filled in on send. Falls back to the business default in
  Settings, then to a built-in.
- **Recurring monthly** with a billing day (1 to 28) and optional
  retainer-specific terms.
- A **live preview** of the document beside the editor, and a Print button.

### Recipients: one rule, one implementation

`resolveRecipients()` in `src/lib/recipients.ts` serves invoices, reports and
every reminder that follows them. `invoiceRecipients()` in
`src/lib/invoices-send.ts` wraps it for the invoice paths.

- **An empty `recipient_user_ids` means EVERYONE on the account**, not nobody.
  Every invoice predating migration 0031 carries an empty array, and a
  one-contact client should never have to configure anything.
- **A chosen id that has left the account drops out.**
- **An empty RESULT is a stop, never a fallback to everyone.** Falling back
  would email precisely the person who was deselected. `sendInvoiceWith` throws
  and the invoice stays a draft.
- The picker shows email addresses, not just names, because the whole question
  is which inbox it lands in. With one contact it stops asking and just says
  who gets it.

### Sending

The Send button opens a confirm that **names every recipient with their email
address**. A confirm that says "the client" is how an invoice reaches someone it
was never meant for. A $0.00 total triggers a second confirm, because that
almost always means the line items did not save.

Order of operations on Send: save, then make the PDF through
`/api/invoices/[id]/pdf` (a route handler, which can take 60 seconds), then
call the send action.

**Nothing renders inside a server action, ever.** An action inherits the page's
ten seconds on Hobby and a cold Chromium start does not finish in ten. The
invoice send did render, once, and pressing Send hung and died with a blank
screen.

What the send itself does (`sendInvoiceWith`):

1. Resolves recipients. Empty result throws.
2. Attaches the PDF if one is on the row. **A missing or unreadable PDF never
   stops an invoice send** (it logs a warning and goes with a link), because
   the recurring cron sends these with nobody watching and an invoice that does
   not arrive is worse than one carrying a link. This is deliberately the
   opposite of the report rule.
3. Inserts an in-portal notification per recipient and emails each one.
4. Writes an `invoice_sends` row **snapshotting** the revision, total, due date
   and the addresses it actually reached. Snapshotted, not joined: a later
   correction is exactly what would otherwise rewrite that history. Written
   BEFORE the status flip, so a half-successful send still leaves evidence.
5. Flips status to `sent`, sets `sent_at` only if it was null, and always sets
   `last_sent_at`.

### Amend and reissue (migration 0033)

**A sent invoice may be corrected and reissued under the same number.** For an
unpaid one that is the ordinary fix, and it beats voiding and raising a new
number, which leaves the client holding two documents for one job.

- `revision` bumps only when an already-sent invoice is saved.
- The email subject reads **"Updated invoice INV-0042"** once `revision > 0`,
  because calling a correction a new invoice makes a client think they owe
  twice. A plain resend of an unchanged invoice still reads as the original.
- `sent_at` is the FIRST send and never moves. `last_sent_at` carries resends.
- Resend saves first, then sends, so a resend never goes out before the fix
  lands. It refuses on a paid invoice: if the numbers changed on something
  already paid, that is a credit or a fresh invoice, not a quiet reissue.
- A gold banner on any sent invoice says it is already in somebody's inbox and
  explains the correct fix, before anything gets changed rather than after.

### Test to me

Sends the identical email to Kyle's own address, **reading the SAVED row rather
than form state**, so a proof shows what is stored. It carries the PDF too,
because a proof that leaves out the thing being checked is not a proof. It
records nothing: no notification, no status change, no `invoice_sends` row.

### The PDF (migration 0043)

`src/components/documents/DocumentPdf.tsx`, one card above the builder, shared
with reports.

- **Make the PDF** renders it now (headless Chromium via `puppeteer-core` and
  `@sparticuz/chromium`), so it can be opened and read before Send.
- **Upload** attaches one by hand, which is the way out when a render fails or
  comes out wrong. The send behaves identically either way.
- **Print page** opens the exact page the renderer photographs, signed and
  openable in a real browser, so "was the page wrong or the rendering wrong"
  has an answer.
- **Remove** takes it off, so the email goes with a link only.
- A **staleness warning** appears when `pdf_uploaded_at` predates the invoice's
  `updated_at`. Nothing can tell that from the file, so the two timestamps are
  simply shown to disagree.
- The filename is the client name plus the invoice number, because that is what
  a client files it under and what a bookkeeper searches for.

The print route `/print/invoice/[invoiceId]` is public in middleware and
carries its own check: an HMAC token signed with `CRON_SECRET`, scoped to the
kind AND the id, good for five minutes (`src/lib/print-token.ts`). Signing the
kind means a token minted for a report cannot be pointed at an invoice.

### Recurring billing

`/api/cron/recurring`, daily at 06:00 UTC.

- Evaluated in **Australia/Brisbane** time, so a billing day matches what Kyle
  set regardless of the cron's UTC runtime.
- Due once the billing day has arrived this month (`today >= anchor`), so a
  missed cron day self-heals on a later run, and never back-bills a period whose
  billing day predates the template's issue date.
- One invoice per template per month, enforced by a unique index on
  `(recurring_source_id, recurring_period)`. A 23505 on insert means "already
  billed"; if the existing one is still a draft, the send is finished off
  ("recovered-send").
- **Skips paused and soft-deleted clients.**
- Copies the template's recipients, so an automated monthly invoice never goes
  wider than the one it was modelled on.
- `{service_period}`, `{service_start}` and `{service_end}` in a line
  description, a title, the notes or the email message are substituted per
  cycle, so "Service period 6 August to 5 September" does not still say August a
  year later.
- Renders the PDF first, ignoring failure, then auto-sends with
  `adminNotice: true` so a machine never bills a client silently.

**The template itself is never sent.** In the builder, a draft with "Recurring
monthly" ticked shows "auto-sends monthly" where the Send button would be. The
template is a pattern; the cron makes and sends copies.

`ScheduledInvoices` (a card above the invoice list) pulls every active template
out of the list, showing the billing day, the terms, the next issue date, the
due date and the monthly total across all retainers. A standing arrangement that
will quietly charge a client next Tuesday looks identical to a one-off from
March in a list sorted by creation date.

### Reminders

`/api/cron/overdue`, daily at 08:00 UTC. Two jobs:

1. **A heads-up before the due date**, once per invoice, `reminder_days_before`
   days out (default 3). This is the one that prevents lateness rather than
   chasing it.
2. **The overdue nudge**, at most once a week per invoice, plus a one-time
   in-portal alert to Kyle the first time an invoice tips over. He is not
   re-alerted weekly: a repeat alert to the person who cannot pay it is noise.

Both go to the same people the invoice went to, through `invoiceRecipients`.
**Neither attaches the PDF.** See "Risks and gaps".

### Delivery tracking (migration 0034)

Every `sendEmail` writes an `email_events` row; the Resend webhook at
`/api/webhooks/resend` moves it along. On the invoice page:

- **`SendHistory`** lists every `invoice_sends` row, newest first, with the
  snapshotted amount, due date, revision, the addresses, and a delivery dot per
  address.
- **`LastSent`** summarises the most recent one in the header.
- `deliveryFor` (`src/lib/email-delivery.ts`) matches an address to the earliest
  event at or after that send, with a minute of slack for clock skew. An
  unmatched send shows no marker rather than guessing.
- **"Sent" renders grey, not green.** The gap between "we sent it" and "it
  arrived" is the entire point.

### What the client sees

`/invoices` lists everything except drafts, newest issue date first, with the
number, due date, amount and status. `/invoices/[id]` shows the full document
with a Print button. A draft, or another client's invoice, 404s.

There is no payment integration. Payment is by bank transfer, with the BSB and
account number printed on the document from Settings.

---

## 9. Reports

Admin builds at `/admin/reports/[reportId]`
(`src/components/reports/ReportEditor.tsx`); the client reads at
`/reports/[reportId]`.

### Two ways to start one

- **New report**: pick a client and a month, and get a draft pre-filled from a
  template: one metrics section per enabled service (with the lead metric
  charted), then Insights and Recommendations. If a report already exists for
  that client and month, it opens that one instead.
- **Import Markdown**: paste a draft. Reports get written as Markdown long
  before they get typed into a form, so the draft is the input. A leading `# `
  becomes the title, each `## ` becomes a section in order, and **everything
  above the first `## ` becomes the Opening**, which is usually the at-a-glance
  block. Horizontal rules separating sections are dropped, since the section
  cards already provide that separation. It refuses if a report already exists
  for that client and month.

`reports.summary` (the Opening) was written by the importer and rendered by
nothing for its entire life. It renders now and is editable. If a report field
exists, check that something actually displays it.

### The editor

- **Sections** are drag-reorderable (dnd-kit), each with a kind (metrics,
  insights, recommendations, custom), a title and a Markdown body.
- **Blocks** inside a section: metric blocks (pick a metric, optionally charted)
  and image blocks (uploaded to the private `pulse-reports` bucket, with an
  optional caption).
- **Insight snippets**: a personal library of reusable text in Kyle's voice,
  saved from the sidebar and droppable into any section.
- **Page break** per section, toggled on the card. CSS can stop a heading being
  orphaned or a table row sliced in half, but it cannot know that a section is
  a new chapter. Stored in the section's JSON `content`, which is why it needed
  no migration.
- **Live preview beside every body field**, rendered by the document's own
  `ReportText` with the document's own styles, so what is shown is what prints.
  It is ONE setting for the whole editor, remembered in `localStorage` under
  `pulse.report.preview`, not a switch per card: the answer was the same on
  every section of every report. It describes how a browser window is being
  used, so it should not travel between machines or be something a save can
  conflict over. It starts off and corrects itself on mount, since reading
  storage during first render makes server and client disagree.
- **Brand switch** (Hartwell or Ironpeak). Saved on its own the moment it is
  switched, not folded into Save, because the preview opens in another tab and
  reads what is stored.
- **Placeholder warning.** `findPlaceholders()` scans the Opening and every
  section for `[ADD: ...]`, `TODO`, `TBC`, `TBD`, `XXX`, `FIXME`, and shows the
  first six in a warning banner, recomputed as you type. It appears again in the
  send confirm, because that is the only moment it matters and the moment it is
  easiest to forget. Markdown links are not treated as gaps.
- **Preview** opens the exact page the client sees, in a new tab.

### The report body language

`src/components/reports/ReportText.tsx`. **A closed Markdown subset, not a
library**, so nothing in a body can inject markup. Everything is parsed into
React elements.

| Syntax | Renders as |
|---|---|
| blank-line separated text | paragraphs |
| `- ` | bullet list |
| `1. ` / `1) ` | numbered list, `<ol>` |
| `### ` | subheading |
| `\|a\|b\|` with a `\|---\|` divider row | table, scrolling in its own box so a wide table never drags the page sideways on a phone |
| `**bold**` | bold |
| `---` | horizontal rule |
| ` ```stats ` | a row of label / value / optional note stat cards |
| ` ```bar Title ` | a bar chart; a third column draws a second, paler bar |
| ` ```compare Title ` | two figures side by side, plus a note line |
| ` ```note Title ` | a callout; blank lines split it into paragraphs |

The fenced blocks exist because a column of numbers in a table is data and a
report is meant to make a point. A bar chart shows at a glance that one query
carries the whole result, which a table makes you work out. An unknown fence
shows its contents in a `<pre>` rather than swallowing them.

`note` is one style rather than a light and a dark one: two boxes competing for
the same job is a decision to make on every callout for no gain.

**Numbered lists take their numbers from position, not from what was typed**,
so inserting a step does not mean renumbering the rest. The ONE exception is
the first item of a run: start it at 4 and the list starts at 4, which is how a
set of recommendations split under two subheadings stays one sequence instead
of restarting.

**A document must never hardcode a colour.** Chart strokes, bars and fills all
read `--pulse-gold`, which `doc-light` swaps for steel. That is what lets one
component serve both brands without a prop threaded down to it.

### Publish and Send are separate acts

**Publish** makes the report visible to the client and stamps `published_at`.
**Send** emails the chosen people and stamps `sent_at`. Migration 0032 dropped
the `reports_notify` trigger that used to put a line in everyone's WEEKLY
digest on publish, which meant a finished report could sit unmentioned for six
days, went to every person on the account whether or not it was meant for them,
and recorded nothing.

**Publish also makes the PDF**, in that order (save, publish, then render),
because the renderer opens the stored report and a PDF made before the save
would be of the previous version. A render failure does not fail the publish:
the report is visible either way, the previous PDF is untouched, and the card
offers "Make it again" or an upload.

**Rendering is deliberately off the report send path.** Chromium is slow to
start and a serverless timeout is a real outcome, and none of that may stop a
client's report reaching them.

Send:

- Refuses on a draft: a client cannot open a draft, so the email would arrive
  with a link to nothing.
- Confirms with every recipient named, the outstanding placeholders, and
  whether a PDF is attached.
- **If a PDF is attached it MUST go.** A download failure stops the send with a
  message rather than quietly degrading to a link-only email nobody knows is
  degraded. This is the opposite of the invoice rule, because a person is there
  to read the message.
- Greets each recipient by their own first name.
- Stamps `sent_at` last, so a failure part way through leaves it looking unsent
  and Kyle sends again rather than believing it landed.

### Test to me

Offered on a DRAFT as well as a published report. Checking a report is right is
what you do before the client can see it, and making publishing the price of a
test had that backwards. It reads the saved row, carries the PDF, and **the
result names the file it attached or says plainly that none was**, because "it
looked fine" does not answer "did the attachment go".

### Deleting

Drafts only, checked on the stored row rather than on what the page thinks. A
published report has been sent to a client and may already have been read, so
it is unpublished as a considered act first. That mirrors invoices, where a
sent one is voided rather than deleted. Uploaded images are swept on delete,
because an orphaned file in a private bucket is invisible and pays rent forever.

### What the client sees

`/reports` lists published reports only, newest month first.
`/reports/[reportId]` is `ReportViewerChrome`: a sticky section index down the
left, a search box that dims non-matching sections, a "Download PDF" button
that calls `window.print()`, then the sheet itself with its letterhead, the
body, and a colophon.

**The letterhead renders on screen AND in print, deliberately.** A print-only
letterhead means the first time anyone sees the branded document is after it
has been sent.

An Ironpeak report is a white document in Ironpeak's own typography even on
screen, the same as its invoices, so what is previewed is what prints. A
Hartwell report keeps the dark house look on screen and flips to light in print.

**The tab title is the suggested PDF filename**, so it is `{client} - {title}`
on the client page, the admin preview and the print page alike. A file called
"Report preview.pdf" reaching a client is a mistake. (See Risks: `TabUnreadBadge`
appears to overwrite this.)

### Print pagination

In the `@media print` block of `globals.css`. Headings keep with their text,
table headers repeat per page, rows and cards never split, and paragraphs use
`orphans`/`widows` rather than `break-inside: avoid` so a long one can still
flow.

---

## 10. CRM and outreach

Admin only, `/admin/crm`, `/admin/crm/[orgId]`, `/admin/crm/plan`. `crm_*`
tables are gated on `is_admin()`, so a client never sees a prospect.

### One CRM, two pipelines

Toggled by `?brand=` on `/admin/crm`: **ironpeak** and **hartwell**. Prospects,
lists and metrics are all brand-scoped so a reply rate from one client base
never averages into the other.

**The rule sets differ, deliberately.** Ironpeak's gates (a two-email cap, a
dated and verified fault before a first email, the nine pre-send checks) are
defence playbook strategy and fire only for `brand = 'ironpeak'`. Applying them
to the general client base would make the CRM unusable for it.

**Universal for every brand, because it is law rather than strategy:** the Spam
Act 2003 covers every commercial electronic message sent in Australia, so the
opt-out and the full consent trail are required before any outbound email is
logged, whichever brand it is.

### The board

`CrmHealth` sits above everything: blocking conditions first, then the numbers.

- **At capacity**: live engagements at or above the limit pauses outbound
  sending. Three yeses in a fortnight breaks a one-person business.
- **Abort warning**: sends since the last substantive reply at or above the
  threshold (15) says stop and reconsider the offer rather than finishing the
  list on momentum.
- **Opt-outs and complaints is the first stat and stays first.** It is the
  health metric, not the reply rate. Target zero.
- Then sent this week against goal, replies, substantive replies, a goal ring
  and a streak, and today's due tasks with a tick.
- Goals are editable inline. Kyle set 3 a day and 15 a week on 30 July 2026,
  five times the playbook's benchmark of 3 a week, having been shown the
  trade-off (the abort warning now lands after about a week rather than five).

Below it, `PipelineView`: a source-list switcher, a stage strip of counts, and
the prospect table. **Prospects belong to a source list** (`crm_lists`) so a
reply rate from a grant list and one from a cold trade show never average into
a single meaningless number.

**Ironpeak runs on exactly one list**, `ironpeak-pipeline`, maintained by
`replacePipeline`. Before that, 12 companies sat on an old grant-recipient list
and 18 carried no list at all, and since the view auto-selects a single list and
filters to it, those 18 never appeared on the board. A list nobody chose,
quietly hiding rows, is worse than no list.

### A prospect record

`/admin/crm/[orgId]` (`src/components/crm/ProspectDetail.tsx`). Company facts
(funding, grants, site, platform, ABN, established year), a research form (the
lead finding, how it was checked, the technical domain finding, the positive
finding, what to keep out of the first email, a blocker), a contact form (who
they are and the consent trail), reach-them tap targets, the send panel and the
full touch history.

**Reach them** (`ContactActions`) is built for a phone: mail app, dialler,
LinkedIn, their site, and a copy button. Copy matters most, because Kyle writes
the real email in Outlook and getting the exact published address onto the
clipboard without retyping it is the whole job. **The published address is shown
verbatim, never tidied**: it is the evidence that inferred consent attaches to
it, and a helpfully lowercased copy is no longer the string that was published.

`email_as_published` and `direct_email` are different fields on purpose. The
published one is the consent evidence and must never be overwritten by a
personal address given later.

`email_source_note` holds where the address appears in words ("footer and
contact page"). It is NOT a URL and must never be turned into one: what the
Spam Act needs is that it was published plus when it was checked, and a
fabricated URL fakes the one thing that has to be checkable.

`hard_warning` is undismissable. PRP Manufacturing's founder died in November
2021: never reference the founder or company history. Micca Holdings has no
LinkedIn, so email only and never attempt a connect.

### The rules are enforced in Postgres, not in the UI

`crm_touch_guard` (last rewritten in migration 0040) refuses an outbound touch
insert when:

- the contact has opted out;
- the organisation is `declined`, `stopped` or `do_not_contact` (terminal on
  every channel);
- for email: the stage is `blocked` (the address is no longer conspicuously
  published, so inferred consent has lapsed), `linkedin_only`, or `email_closed`
  (their mail server refuses this sender, so email is dead but LinkedIn and the
  phone stay open);
- the consent trail is incomplete: published address, where it appears, verified
  date, consent basis and relevance note are all required;
- for Ironpeak only: two non-bounced emails already sent with no reply; a first
  email with no recorded fault, no verification date, or a date older than 14
  days; fewer than nine pre-send checks ticked.

**A bounce does not spend one of the two emails.** Four companies bounced
because of a sending-side fault at Kyle's end; nobody saw a message, so nobody
refused anything. The touch itself stays, because deleting evidence to fix
arithmetic is the wrong trade. A re-send logs as `email_1`: a message nobody
received is still the first one they will read.

Anything filtering by stage for sending must include `queued`, `contacted` AND
`bounced`. That filter has been too narrow three times, and each time the
symptom was silence rather than an error.

Also enforced by trigger: one contact per organisation, and a negative reply,
bounce or opt-out closing the company and clearing its tasks (see Risks: this
last one still treats a bounce as terminal, which contradicts 0040).

### The outreach flow: the portal drafts, Outlook sends

**The portal does not send outreach, and that is not a preference.** On 10 and
11 August 2026 four Microsoft Graph sends produced four `550 5.7.708`
rejections to four unrelated recipient domains, while every message Kyle typed
by hand in Outlook the same day arrived, including a cold prospect sitting
between two of the failures. SPF, DKIM and DMARC all passed and restricted
entities was empty, so it was neither an account block nor authentication. The
remaining difference was the submission path.

**The Microsoft 365 tenant itself is now blocked** (`TenantAccessBlockedException`
on OWA), read as the later stage of the same outbound reputation flag. **Do not
resume scheduled sending until the block is resolved AND the sending
arrangement has changed**: cold outreach from `kyle@ironpeakconsulting.com.au`
risks the mailbox the website contact form and live client correspondence
depend on. `graphSendMail` has been deleted rather than left sitting unused.

The flow as it stands:

1. **Write** the subject and body on the record (`saveOutreachEmail`). Editing
   the body clears any approval, because an email that changed is not the one
   that was read.
2. **Schedule** a send time (`setScheduledSendAt`). Rescheduling deliberately
   does NOT clear approval: none of the nine checks becomes untrue because it
   goes at three instead of nine, and making a reschedule cost nine re-ticks
   would train the habit of ticking without reading.
3. **Approve** (`approveForSending`). All nine checks must be ticked, a subject
   and body must exist, a send time must be set, and the guard is run as a **dry
   run** (`crm_dry_run_touch`) so a record that would be refused at send time is
   refused now, while there is someone to read why. **The checks are ticked at
   APPROVAL, not at send**, because nobody is at the keyboard at 08:47 and a
   checklist confirmed by a machine is not a check.
4. **Draft.** `/api/cron/crm-send` runs every few minutes from cron-job.org and
   calls `graphCreateDraft` at the scheduled minute, leaving a finished draft in
   Outlook with a deep link straight to it. Or press "Draft now". Either way
   `draft_created_at` is stamped, which stops the cron re-drafting the same
   email every few minutes. A record that cannot be drafted has
   `send_approved_at` cleared, so it stops being retried and starts being
   something to look at.
5. **Kyle presses send in Outlook.**
6. **Confirm** in the portal (`markSent`). **This is the only place an outbound
   email touch is created.** It writes the touch with the exact drafted text,
   advances the stage, sets `followup_due` at day 8, and writes the next action.

**A draft is not a send, and nothing at draft time writes a touch.** Logging at
draft time would fill the Spam Act record with messages that never left, which
is exactly the failure this replaced: evidence of something that did not happen
is not evidence.

`scheduled_send_at`, `draft_created_at` and a logged touch are three different
things: when it is planned to go, that it is written and sitting in Drafts, and
the actual send. Only the third advances the stage, counts toward the goal, and
stands as the Spam Act record.

### The signature and opt-out

Appended in `buildOutreachText`, never stored in a body. A footer retyped 30
times is wrong on at least one of them. Plain text, never HTML: a cold email
that arrives as a styled document reads as marketing however good the words are.

**The opt-out is a reply, not a link**, and that was a correction rather than a
preference. The link pointed at `portal.hartwelldigital.com` and was wrong on
three counts, each sufficient on its own: the domain did not match the sending
domain, which is a strong spam signal on cold mail; the token made it
per-recipient tracking, which the settled rules forbid on first contact; and it
published the tie between Ironpeak and Hartwell Digital to every prospect. A
reply satisfies the Spam Act, which asks for a functional low-cost opt-out that
is honoured, and honouring it is the operator's job: the guard blocks every
channel the moment `opt_out_at` is set.

`/unsubscribe/[token]` still exists and still acts on GET, it is simply not
linked from an email any more. It says the same thing whether or not the token
matched, so nobody can test whether an address is on the list, and it carries no
Hartwell wordmark.

Pre-send check c6 exists for the inverse risk: a body pasted in with its own
signature already attached goes out carrying two.

The nine checks live once, in `src/lib/crm-presend.ts`, imported by both the
manual flow and the automated one. They used to be two copies of the same array,
which made the automated path the easy way to skip a check.

Outreach never goes through Resend. Resend sends as hartwelldigital.com, the
domain carrying every invoice and client notification, and cold mail there would
risk the reputation of the mail that pays.

### The send plan

`/admin/crm/plan` is the run sheet. The board answers "where is everything"; the
plan answers "what am I doing today".

- **A warning block at the very top** listing the seven sends nobody can vouch
  for: records that had a finished draft put in Outlook on 12 and 13 August 2026
  with nothing logged after. Held as **written-down constants** in
  `src/lib/crm-unresolved.ts`, not a query, and that is load-bearing: the
  evidence was `draft_created_at`, which replacing the pipeline clears, so the
  database stopped being able to answer the moment "Load v4 pipeline" was
  pressed. **Seven, not sixteen**: the other nine were never approved so no
  draft was ever made, and warning about all sixteen is how a warning gets
  ignored. It warns rather than blocks, and logging the send is the only thing
  that clears it.
- **Everything scheduled**, as one table, with "Lay out the schedule".
- **Today's work**, then overdue follow-ups, then sends grouped by day, each
  row offering Draft now, the Outlook deep link, Mark sent, and Reschedule.

**A row is ticked off from the touch log, never from `send_attempted_at`.** Only
`markSent` writes that column, so anything logged through the manual flow stayed
on the board as outstanding work forever: Copamate and NH Micro went on 30 July
and were still listed as to do three weeks later. `sent_at` is computed on the
plan page as the latest outbound touch whose outcome is not `bounce`, which also
puts the "a bounce is not a send" rule in one place instead of in a stage check
in each component.

### Lay out the schedule (`autoSchedule`)

Applies the fixed rules in one press rather than by hand in SQL:

- four a day, weekdays only;
- **never on the hour or the half hour**. Mail that lands at 9:00 reads as
  machinery; 08:47 reads as a person who happened to be at their desk. The slot
  times are the ones already proven in the handoff, so a week of them still
  reads as a person at their desk;
- WA companies at 11:00 AEST or later, so they land mid-morning Perth;
- a follow-up inside its day 8 to 10 window rather than before it opens. **The
  window beats the four-a-day shape**, because a follow-up sent early is worse
  than a day carrying five;
- **never places anything in the past.** It used to pin a follow-up to its
  stored `followup_due`, and nine of those windows opened in early August and
  closed again, so the whole plan rendered as a list of dates that had already
  gone. A lapsed follow-up now queues from the start day and takes its turn;
- anything already drafted keeps its time;
- `blocked`, `linkedin_only` and `email_closed` get no slot at all.

### Loading the pipeline

"Load v4 pipeline" on `/admin/crm` applies `src/lib/crm-pipeline-v2.ts`: 30
companies, **generated** by `scripts/gen-pipeline.py` from
`portal-handoff-pipeline.md` and never hand-edited. Nineteen email bodies
retyped by hand is nineteen chances to change a word Kyle chose, and he has
explicitly rejected specific phrasings. Change the markdown and regenerate.

The current data is version 4, 18 August 2026. It rewrote 16 of the 19 bodies to
the shape fault, second observation, scope block, link, costless close, at 150
to 175 words, merged the greeting into the opener, and corrected Owen
International's subject, which called DISP an accreditation and would have gone
out that way. **Two exceptions are deliberate and must not be normalised:**
Kennewell runs 198 words with no link, because its offer is a caption pass
rather than a rebuild, and Universal Motion Simulation opens "Good morning Dr
Meikle".

`HARD_WARNINGS` in the generator is keyed by rank number, not by company. Ranks
held across version 4, so the five warnings still land correctly, but a future
handoff that re-ranks anything has to move that dict with it or the PRP founder
constraint attaches to the wrong company.

What `replacePipeline` does:

- **Replaces, but UPDATES rather than wiping.** Companies that already exist are
  updated in place so the touch log survives, and that log is the Spam Act
  defence.
- A company dropped from the list but carrying a logged send is marked `lost`,
  never deleted.
- The portal's stage wins where the portal knows more, with two exceptions:
  `bounced` and `email_closed` are things only the file knows, so the file wins
  outright on those.
- **It clears `draft_created_at` as well as the approval.** The cron reads a
  non-null value as "done", so a record drafted under an old body would never
  draft again and the rewritten email would sit approved and silently
  undraftable. **Drafts already sitting in Outlook still hold the OLD text and
  have to be deleted there by hand.**
- It creates the companies it cannot find, so it bootstraps an empty pipeline on
  its own.
- It maintains the single `ironpeak-pipeline` list and deletes any other empty
  Ironpeak list.

The earlier datasets are gone. `crm-seed-data.ts`, `crm-pipeline-master.ts` and
the four actions and two components that applied them were deleted with version
4: every one of them would have resurrected the companies that were deliberately
triaged out. The target-NN research files in the Drive folder are superseded and
must not be re-imported.

The offer was repositioned on 7 August 2026 from capability statements to
websites. The first 14 sends led with a capability statement and produced zero
replies in eight days; across roughly 50 researched companies at least nine had
paid an agency for a website and none had a capability statement. Every hook is
now a specific verified fault on the company's own site.

**Absence claims are the ones that go wrong.** Kennewell was wrong twice and
Micron once, all the same way: a claim about "your site" built from one page, or
from text alone. Kennewell's "empty" work page holds 29 photographs and Micron's
about 63, both loaded by JavaScript. Crawl every page, count images and gallery
markers rather than text, and prefer presence claims: "I found this on your
site" is provable, "there is no X" is not.

### After a send is logged

Logging email 1 books the two things that otherwise get forgotten: the LinkedIn
connection request a day later (under 200 characters, mention the email, no
pitch) and email 2 at day 8 to 10. Logging a LinkedIn connect or email 2 closes
the task it satisfied.

Logging a reply with outcome `opt_out` books a task to action it and record the
date within five working days, which is what the Spam Act requires.

`/api/cron/crm-reminders` (daily) books a re-verify task when a prospect's
evidence goes stale past `reverify_after_days` (default 14), because a fault
cited in an email that has since been fixed destroys credibility. **It no longer
turns every due task into a notification.** That loop was the thing driving Kyle
mad: a notification could only be read, and reading one changed nothing, so it
came back the next morning. Those tasks are work items now.

### Benchmarks that do not change

2 to 3 substantive replies per 15 sent, and **zero opt-outs**. That last one is
the health metric, shown first.

---

## 11. Notifications and email

### The notification table

Every notification is a row per recipient with a `type`, a `channel`, a title,
a body (capped at 140 characters by the triggers), a link and a `read_at`.
Clients and admins can only UPDATE `read_at`, enforced by column-level privilege
plus a guard trigger (migration 0006).

**Three channels**, which decide how it reaches a person:

| Channel | Delivery |
|---|---|
| `instant` | Bell immediately, email on the next `/api/cron/email` run |
| `digest` | Bell immediately, email in the Monday weekly digest |
| `in_portal` | Bell only, no email, unless it sits unread for 30 minutes (see below) |

**What produces one:**

| Event | Who hears | Channel |
|---|---|---|
| Kyle messages a client | that client user | instant |
| A client messages Kyle | every admin | in_portal |
| A client messages a group | fellow client members | instant |
| A client uploads a file | every admin | in_portal |
| Kyle uploads a file | that client's users | digest |
| Kyle comments on an asset | that client's users | digest |
| A client comments on an asset | every admin | in_portal |
| An invoice is sent or resent | chosen recipients | instant, pre-stamped as emailed |
| An invoice is auto-sent by the cron | every admin | in_portal |
| An invoice falls due soon | chosen recipients | instant |
| An invoice goes overdue | chosen recipients, plus admins once | instant / in_portal |
| A report is sent | chosen recipients | instant, pre-stamped as emailed |
| The morning brief | every admin | instant |
| A timed work item is due now | every admin | instant |

Note that report and invoice notifications are inserted with `emailed_at`
already set, because the sender emails them directly. That keeps the cron from
sending a second copy.

### The bell

`src/components/notifications/NotificationBell.tsx`. The 20 newest, realtime
plus a 15-second poll (Chrome throttles background tabs and sockets drop). A new
unread one plays a soft synthesised two-note chime (no audio asset to load,
toggleable), and a new **message** also raises a desktop notification where
permission has been granted. The first load only seeds a baseline, so opening
the portal does not chime for the existing backlog.

### Email out

`src/lib/email.ts`. Resend, from `EMAIL_FROM` (default
`Hartwell Digital <noreply@hartwelldigital.com>`). Missing `RESEND_API_KEY` logs
and skips rather than throwing.

`emailLayout` is a plain HTML shell in Kyle's voice with an optional gold CTA
button. `renderMessage` turns a plain-text template with `{placeholders}` into
paragraphs, **escaping the template and every value**, so a client name with an
`&` can never break the email or inject markup.

### The email crons

**`/api/cron/email`**, daily 07:00 UTC. Three jobs:

1. Non-message `instant` notifications go out one per item.
2. Message notifications batch **one email per away-period, Slack style**. All
   pending message notifications for a recipient become a single summary, one
   line per sender with the newest preview. **While an earlier message email
   sits unread in the portal, nothing more is sent.** Reading the portal is what
   re-arms email. Suppressed rows keep `emailed_at` null, so they are picked up
   on a later run if still unread.
3. **The 30-minute nudge.** Admin-facing `in_portal` notifications (client
   messages and client uploads) that are still unread after half an hour are
   emailed to the admin as one summary with a per-client breakdown, so nothing a
   client sends or uploads is missed. Same re-arm rule.

**`/api/cron/digest`**, Monday 08:00 UTC. Batches pending `digest` notifications
into one weekly email per recipient.

### Delivery events (migration 0034)

Every `sendEmail` writes an `email_events` row. The Resend webhook at
`/api/webhooks/resend` moves it along.

- **Signature verification is hand-rolled** in `src/lib/svix-verify.ts` rather
  than pulling in `svix` for one route. The timestamp tolerance is not
  decoration: without it a captured request replays forever. An unverified
  endpoint would let anyone on the internet mark an invoice as bounced.
- **Status only ever moves FORWARD through `RANK`.** Webhooks arrive out of
  order and a late "sent" must never overwrite a "bounced". Terminal outcomes
  (failed 90, complained 95, bounced 99) outrank everything.
- An event about something we did not send is acknowledged, not errored, so
  Resend stops retrying.
- **`recordEmail` swallows its own failures after logging.** Telemetry that can
  stop an invoice reaching a client is worse than no telemetry.
- Needs `RESEND_WEBHOOK_SECRET` in Vercel plus an endpoint configured in Resend.

### The cron schedule

Vercel Hobby caps its own crons at once daily, so anything sub-daily runs from
cron-job.org hitting the same endpoint with `CRON_SECRET` as a bearer token.
`cronAuthorized` fails CLOSED: a missing secret is a 503, never an allow.

| Endpoint | Schedule | In `vercel.json`? | What it does |
|---|---|---|---|
| `/api/cron/recurring` | 06:00 UTC daily | yes | Materialise and auto-send recurring invoices |
| `/api/cron/email` | 07:00 UTC daily | yes | Instant notification emails plus the 30-minute admin nudge |
| `/api/cron/overdue` | 08:00 UTC daily | yes | Due-soon heads-up and the overdue nudge |
| `/api/cron/digest` | Mon 08:00 UTC | yes | The weekly digest |
| `/api/cron/purge-clients` | 04:00 UTC daily | yes | Purge clients and conversations past the 30-day window |
| `/api/cron/crm-reminders` | 22:00 UTC daily | yes | Book re-verify tasks |
| `/api/cron/brief` | 21:00 UTC daily (7am Brisbane) | yes | The morning brief |
| `/api/cron/work` | hourly, intended | **no** | Generate work items, materialise recurrences, nudge timed items |
| `/api/cron/crm-send` | every few minutes | **no** | Put approved outreach into Outlook Drafts |

The last two must be set up on cron-job.org. `/api/cron/work` is safe to run as
often as you like.

**One notification a day for Kyle's own work.** The brief stays silent when
nothing is due, and names the first three items rather than only counting them,
because "7 things due" is a number and "Send Kennewell" is a thing you can
picture doing. Client-triggered notifications are untouched, because those are
someone waiting.

**Overdue asks once.** Seven days unanswered raises a question in the brief;
answering sets `asked_at` and it never returns. That is the difference from the
notification it replaced.

**The timed nudge fires once**, guarded by `nudged_at` (migration 0046).
Without that column the hourly cron would announce the same 08:47 send every
hour, which is the nagging again. Its window looks backwards an hour and
forwards ten minutes, because the cron runs on the hour and 08:47 must be
announced on the 09:00 pass rather than missed for being in the past.

---

## 12. Search and the command palette

**Cmd+K** (or Ctrl+K) from anywhere, plus a visible Search button in the header,
because a shortcut nobody knows about is a shortcut nobody uses and on a phone
there is no keyboard to press it on. The button fires a window event rather than
lifting the palette's state into the shell.

With no query it lists the nav, so the shortcut is also just a faster sidebar.
Typing two or more characters hits `searchEverything()`
(`src/app/actions/search.ts`), debounced 180ms, with a sequence guard so a slow
early request cannot repaint the list with stale results.

Groups: Go to, Clients (admin only), Invoices, Reports, Assets, Copy, Pipeline
(admin only). Capped at five or six per group, because a palette is for jumping
to the thing you were already thinking of, not for browsing.

**The search is a flat sweep with NO role branching, on purpose.** It runs on
the RLS client, so a client account gets their own rows and `crm_*` returns
nothing for them. Adding a branch there would be a second access-control system
to keep in step with the first. The only role checks are two `isAdmin`
short-circuits that skip queries which would return nothing anyway, and the
choice of `/admin/...` versus client hrefs.

---

## 13. Look and feel

### Theme

Dark by default. `THEME_SCRIPT` is inlined into `<head>` and runs before first
paint, or every load flashes. The toggle sits in the header and writes
`localStorage["pulse-theme"]`.

**`prefers-color-scheme` is deliberately NOT read.** The portal looking
different to a client than it does to Kyle, because of an OS setting neither of
them chose, is a support question waiting to happen. Light is a choice someone
makes here.

**The light gold is a different gold.** `#b5a675` is about 2.3:1 on white, fine
as a hairline and unreadable as text, so light mode uses `#8a7645`, and
`gold-light` (meaning "more prominent on hover") goes DARKER. Never assume a
token flips to its literal opposite.

The `@media print` token block lists all three root selectors so it beats
`[data-theme="light"]`, which is more specific than a bare `:root`.

Clerk's `variables` appearance is still hardcoded dark, so the UserButton
popover stays dark in light mode. Left alone rather than risking auth UI that
cannot be tested from here.

### Welcome flash

A brief "Good afternoon, Kyle" over the wordmark, **once per browser session**,
not once per page (`sessionStorage`, so it survives client navigation and a
refresh but greets a fresh tab). It is `pointer-events-none` throughout: a
greeting that swallowed the first click of the session would be worse than no
greeting.

### Celebrations

`src/lib/celebrate.ts`. A toast plus a two-vent confetti burst on a canvas, no
dependency, removing itself after about 150 frames. `prefers-reduced-motion` is
honoured: the toast shows, the confetti does not.

**Admin surfaces only.** Clients are businesses and defence buyers are
conservative, so confetti in a client portal would read as unserious.

**It fires on OUTCOMES, never activity**, and there are exactly three places:

| Trigger | Where | Tone |
|---|---|---|
| An invoice is marked paid | `InvoiceBuilder.tsx` | success, intensity 3 |
| The day's outreach goal is completed (once) | `ProspectDetail.tsx` | steel, intensity 2 |
| A substantive reply, or a positive reply | `ProspectDetail.tsx` | success 3 / steel 1 |

**Never celebrate a send.** The playbook says volume is the risk, so rewarding
each send would train the behaviour that gets a campaign complained about.
Sending an invoice gets nothing either; being paid does.

### Brand

`src/lib/brand.ts` holds the shared identity. Ironpeak Consulting is a
registered business name against Hartwell Digital's ABN 44 286 503 049, trading
in defence only. Internal surfaces may say Hartwell is the parent; **client-facing
output must not**: no "a business of Hartwell Digital", no dual logos. The bare
ABN line is the only permitted expression of the parent, and it needs no
explanation. No phone number appears on any client-facing Ironpeak document.

Never re-declare the Ironpeak details in a component. Both documents dress in
`doc-light brand-ironpeak` for Ironpeak.

---

## Open questions

1. **How do `metrics` rows get into the database?** The client dashboard and the
   report metric blocks both read `metrics`, and `api_connections` exists as a
   table, but there is no import UI, no ingestion route and no cron that writes
   metrics anywhere in `src/`. Either they are entered by hand in the Supabase
   table editor, or something outside this repo writes them. Unverified.

2. **What is the live value of `business_settings.gst_mode`?** The column
   defaults to `'add'` in migration 0004 and `SettingsManager`'s fallback object
   also says `'add'`, but `CLAUDE.md` records that Kyle is not GST-registered and
   invoices should default to "No GST". The code cannot answer which the live row
   holds. This is the single most consequential unverified fact in this document.
   See Risks.

3. **Does the `services` table get populated anywhere in the portal?** Both the
   client dashboard and the report template read `services` where `enabled`, but
   nothing in `src/` inserts or edits a service row. Same likely answer as
   metrics: outside the app.

4. **Was `board_cards` ever actually populated in production?** Migration 0044
   migrates its rows into work items and deliberately does not drop the table.
   Whether it held anything worth migrating is not knowable from the code.

5. **Are the two cron-job.org jobs (`/api/cron/work` hourly and
   `/api/cron/crm-send` every few minutes) currently configured and running?**
   `docs/dashboard-spec.md` lists setting up the work cron as still open. Nothing
   in the repo can confirm either way. If the work cron is not running, the
   dashboard only regenerates once a day when the brief runs, and timed nudges
   never fire.

6. **Is the Ironpeak Microsoft 365 tenant still blocked?** As of the last
   recorded note it was. Every outreach draft depends on Graph, so if it is still
   blocked, "Draft now" and `/api/cron/crm-send` both fail.

---

## Risks and gaps

Ordered roughly by consequence.

### 1. A recurring Ironpeak invoice comes out branded Hartwell

`/api/cron/recurring` builds each generated invoice from an explicit field list
(`src/app/api/cron/recurring/route.ts`) and that list omits `brand`,
`deposit_amount` and `deposit_label`. `invoices.brand` defaults to `'hartwell'`
(migration 0023). So an Ironpeak retainer set up as a recurring template will
silently generate and **auto-send** Hartwell-branded invoices every month,
breaching the standing rule that a defence client must never see the parent
brand. Nobody is watching when it happens. A deposit credited on the template is
also dropped, though that is arguably correct for a monthly retainer.

### 2. New invoices may be defaulting to 10% GST

`business_settings.gst_mode` defaults to `'add'` in the schema, and
`createInvoice` copies that default onto every new invoice, which heads the
document "Tax Invoice" and adds 10%. `CLAUDE.md` states Kyle is not GST
registered. If the live settings row still says `'add'`, invoices have been
issuing as tax invoices with GST on them, which is a real problem for a
non-registered sole trader. **Check the live `business_settings` row before
anything else in this list.**

### 3. Reminder emails carry no PDF

Verified, and repeated from the top of this document. `src/lib/invoices-send.ts`
and `src/lib/reports-send.ts` are the only two places anything is attached. The
due-soon heads-up and the overdue nudge in `src/app/api/cron/overdue/route.ts`
send HTML plus a portal link only. That is exactly backwards for the audience:
a bookkeeper who could not open the original portal link is the person most
likely to need the attachment on the chase.

### 4. A logged bounce still terminates the company

Migration 0040 is titled "a bounce is not a refusal" and removes `bounced` from
the terminal stage list inside `crm_touch_guard`. But it does not touch
`crm_touch_after` (migration 0022, lines 373 to 397), which still fires on
`outcome in ('reply_negative', 'bounce', 'opt_out')` and sets the organisation
to `do_not_contact`, which IS terminal on every channel, and closes every
outstanding task. So logging a bounce through the portal's own "Save reply"
control permanently retires the prospect, which is precisely the outcome 0040
exists to prevent. The UI copy in `ProspectDetail.tsx` ("A negative reply, bounce
or opt-out closes this company permanently") is accurate to the database and
wrong against the rule. Fix the trigger, not the copy.

### 5. The compliance checklist disagrees with the database

`complianceGaps()` in `src/lib/crm-shared.ts` requires `email_source_url` and
lists "Source URL it was published at" as an outstanding gap. The database
guard (0035 onwards, still current in 0040) accepts `email_source_url` **OR**
`email_source_note`, and the v4 pipeline importer writes only
`email_source_note` (`src/app/admin/crm/actions.ts` line 660). The contact edit
form only offers the URL field. So every record loaded from the v4 pipeline
shows a permanent, unfixable-through-the-UI compliance gap, while the send would
in fact be allowed. That is a warning that will get ignored, which is the exact
failure mode the CRM tries hardest to avoid. It also pushes toward entering a
URL, which `CLAUDE.md` says must never be fabricated.

### 6. `TabUnreadBadge` overwrites the report tab title

`src/components/notifications/TabUnreadBadge.tsx` sets `document.title` to
`Hartwell Pulse` (or `(n) Hartwell Pulse`) in an effect keyed on `[unread,
pathname]`, and it is mounted once in `Shell`, which wraps every client and
admin page. The report viewer, the admin report preview and the client report
page all set a `generateMetadata` title of `{client} - {title}` specifically
because the browser turns the tab title into the suggested PDF filename. The
effect runs after the metadata title is applied, so it very likely wins, and a
client pressing "Download PDF" gets a file called `Hartwell Pulse.pdf`. The
`/print/report/[id]` route is unaffected, since it sits outside the shell, so
the rendered PDF filename is safe; this is only the browser's own print dialog.
Worth testing rather than assuming, but the code strongly suggests it.

### 7. The command palette's client results 404

`searchEverything` emits Clients hits with `href: /admin/clients/${c.id}`, and
there is no `src/app/admin/clients/[clientId]/page.tsx`. The only route under
that segment is `.../preview`. Searching a client name from Cmd+K and pressing
Enter lands on a 404. It should almost certainly point at
`/admin/clients/[id]/preview`, or at `/admin/clients`.

### 8. Deleted and paused clients still appear in creation pickers

`/admin/invoices/new`, `/admin/reports/new`, `/admin/assets` and `/admin/copy`
all list every `clients` row with no `deleted_at`/`purged_at` filter, unlike
`/admin/reports` and `/admin/messages` which do filter. It is possible to raise
an invoice against a client in the recovery bin.

### 9. Report PDFs are orphaned on delete

`deleteReport` sweeps uploaded images with a single non-recursive
`storage.list(prefix)` over `{client_id}/{report_id}`. The PDF lives one level
deeper, at `{client_id}/{report_id}/pdf/...`, so it is never removed. Only
drafts can be deleted and a draft usually has no PDF, so the blast radius is
small, but a published-then-unpublished-then-deleted report leaves its PDF
paying rent forever.

### 10. A recurring template permanently consumes an invoice number

`createInvoice` allocates from `next_invoice_number()` before anything is
written. A draft turned into a recurring template is never itself sent, so its
number is a permanent gap in the sequence. Harmless for the ATO, mildly
confusing when reading the books.

### 11. Share links cannot reach anyone without a portal login

Covered under Assets. `createShare` hardcodes `require_login: true` and
`/share/*` is not a public route. If the intent was ever "send this file to my
client's accountant", it does not do that. The 7-day expiry is also hardcoded at
both call sites despite the action accepting a parameter.

### 12. Preview page ordering is nominal

`client_previews.position` defaults to 0 and nothing ever writes it. Both the
admin dialog and the client page order by `position`, so the order is whatever
Postgres returns for a tie. The migration's promise of "named pages, in order"
is not actually delivered; there is no reorder control.

### 13. Dead code

- `src/components/admin/ProjectBoard.tsx` (249 lines) and
  `src/components/admin/ProjectCalendar.tsx` (156 lines) are the old
  `board_cards` kanban and calendar. Nothing imports either. They should go with
  `board_cards` when that table is finally dropped.
- `ASSET_FOLDERS` in `src/lib/assets-shared.ts` is a fixed list of five folder
  names from before real folder rows existed. Nothing imports it.
- `assets.folder` (a text column) is still dual-written alongside `folder_id`
  and read by nothing.
- `invoices.discount_label` is rendered on the document and copied by the
  recurring cron, but there is no UI to set it, so it is always the fallback
  "Discount".

### 14. Minor type drift

`NotificationType` in `src/lib/types/database.ts` does not include
`work_brief`, which migration 0045 added to the database check constraint and
which `/api/cron/brief` and `src/lib/work-nudge.ts` both insert. The inserts go
through the untyped Supabase client so nothing breaks, but the union is a lie
and would mislead anyone reading it.

### 15. Stale UI copy

- The report editor's covering-note help text says "The report is a link, never
  an attachment", which stopped being true with migration 0042.
- `/unsubscribe/[token]`'s own doc comment calls itself "the opt-out link at the
  foot of every outreach email". It has not been linked from an email since the
  opt-out became a reply.
- `NewInvoiceForm` and `NewReportForm` both tell the reader to run "the demo
  seed" to create "Demo Co". There is no seed script in the repo.

### 16. Structural notes rather than faults

- **`invoice_sends` has no delivery join key.** `deliveryFor` matches an
  `email_events` row to a send by "the earliest event for that address at or
  after this send, minus a minute". Sends to one person are minutes apart at
  worst so it is unambiguous in practice, but it is a heuristic, and two sends to
  the same address inside a minute would confuse it.
- **`reorderWork` writes positions one row at a time** in a loop, and returns on
  the first error, leaving a half-applied order. Cheap and low-stakes, but not
  atomic.
- **Message realtime is backed by a 4-second poll of the whole thread.** That is
  a deliberate backstop for throttled tabs and dropped sockets, but it means an
  open conversation issues four queries every four seconds indefinitely.
