# Work, the dashboard, and documents

Reference for two domains that share one document: the **work item system** that
drives `/admin`, and the **document system** (invoices and reports) that is the
money path.

Written 2 September 2026 against deployed commit `2dd379a`, by reading the code
rather than the chat history that produced it. Every claim below was checked
against a file, and the file is cited. Where something could not be verified it
says so.

**Who this is for.** Kyle, and any future AI session loading this as operating
context. A session with this document plus the repository should be able to work
correctly on either domain without asking what anything is for.

**Read alongside:** `CLAUDE.md` at the repo root (the project rules, still
authoritative on intent) and `docs/dashboard-spec.md` (the design conversation
behind the dashboard, 26 August 2026). This document verifies both against the
code and records where they have drifted.

---

## Ground truth, established 2 September 2026

**All 46 migrations, 0001 to 0046, are applied in production.** This was proved
by probing the live database for the signature table or column of each migration:
34 probes, none missing. The older note in `CLAUDE.md` that only 0035 to 0041
were verified and everything below was assumed is **superseded and wrong**. Do
not hedge it, and do not repeat the assumption. Applied state is still tracked
nowhere, so re-probe after writing anything new rather than trusting this line.

**Email attachments exist in exactly two files.** `src/lib/invoices-send.ts` and
`src/lib/reports-send.ts` are the only callers that pass `attachments` to
`sendEmail`. Verified by grepping the whole of `src`. Everything else, including
both invoice reminder emails, sends HTML and a portal link. Section 2.10 covers
what that means and whether it should change.

---

---

# PART 1 — WORK AND THE DASHBOARD

## 1.1 What the system is, and why it exists

Everything Kyle owes anyone is a row in `work_items`. Before this, `/admin` read
`board_cards` and nothing else, a table untouched since migration 0001, while the
actual work lived in the CRM, the invoices and the reports. The dashboard was
never opened because it never knew about any of it.

The second problem was the notifications. `notifications` carries `read_at` and
nothing else: no done, no snooze, no "not doing this". `/api/cron/crm-reminders`
turned every due CRM task into a notification every morning, reading one changed
nothing, so the same nine arrived again tomorrow. That was the mechanism behind
the nagging, and it is the thing this rebuild exists to end.

So a work item is a unit of work with a **verb**. Every row can be ticked,
snoozed or declined, and every row remembers where it came from so closing it can
act on its source.

Design and the sixteen decisions behind it: `docs/dashboard-spec.md`.
Schema: `supabase/migrations/0044_work_items.sql`, `0045`, `0046`.

## 1.2 The data model

Three tables, all created by 0044, all **admin only** under RLS via `is_admin()`,
the same pattern as `crm_*`. A client must never see the list of things being
done about them, even when the row names their account.

### `work_items`

| Column | Notes |
|---|---|
| `title`, `detail` | |
| `client_id` | Null means Kyle's own work, not an error |
| `brand` | `hartwell` or `ironpeak`, nullable, for filtering |
| `due_at` | **Null means someday**, a real answer. Never shown on Today |
| `has_time` | True when the clock matters (an 08:47 send), false when only the day does. Ordering and the timed nudge read this rather than guessing from whether the time is midnight, because midnight is both a real answer and a common accident |
| `source_kind` | `manual`, `crm_send`, `crm_task`, `invoice`, `report`, `recurring`, `notification` |
| `source_id` | The row it stands for, for the link through. Deliberately not unique |
| `source_key` | What makes it unique, and it carries a **stage, not a row** |
| `state` | `open`, `done`, `dropped` |
| `done_at`, `dropped_at`, `drop_reason` | One line of reason, so a decision is legible six weeks later |
| `snoozed_until` | Still open, still counted, out of Today until then |
| `asked_at` | "Still doing this?" was asked, once |
| `nudged_at` | The timed nudge was sent, once (0046) |
| `position` | Manual order within a day. Null sorts after anything positioned |
| `hours`, `hours_note` | Logged after the fact, no timer |

`asked_at` and `nudged_at` answer different questions and an item can need both.
`asked_at` means "you have been asked whether this is still happening";
`nudged_at` means "you have been told it is time".

### The partial unique index, which is the whole design

```sql
create unique index work_items_source_open_idx
  on public.work_items (source_kind, source_key)
  where state = 'open' and source_key is not null;
```

A generator may run every hour and can never make a second **open** item for the
same stage of the same thing. The duplicate is refused by the database rather
than by code remembering to look. Same trick the recurring invoice cron already
uses (`invoices_recurring_period_uniq`, migration 0009).

Two properties, chosen separately:

- **Keyed on the stage.** `invoice:<id>:overdue7` and `invoice:<id>:overdue30`
  are different work about one invoice, so a decision about one does not bind the
  other.
- **Partial on `open`.** Once an item is closed it stops blocking, which is what
  lets a later stage arrive.

Read section 1.10 before relying on the suppression behaviour the spec claims
follows from this. It does not, and that is the most important gap in Part 1.

### `work_item_steps`

`id, work_item_id, label, done_at, position`. The checklist inside one item. A
six-step job is one row on Today reading "3 of 6", not six rows. **Steps never
appear on Today in their own right** and ticking every step does not close the
item (`toggleStep` in `src/app/admin/work/actions.ts`).

### `work_item_recurrences`

`title, detail, client_id, brand, pattern, day_of_week, day_of_month, lead_days,
steps jsonb, active, last_made_on`.

Patterns are `weekly`, `monthly`, `quarterly`, `annual`. `day_of_month` is
constrained to 1..28 so February never skips. `steps` is `[{ "label": "..." }]`,
stamped out fresh on every occurrence.

**A recurrence per client is the answer to "what counts as a retained client".**
Nothing infers it from services or invoice history. Kyle sets one up once on
`/admin/work/recurring` and it becomes a fact. An inference would be wrong about
exactly the accounts mid-change, and wrong silently. Pausing uses `active` rather
than deletion, because a client going quiet for two months is not the
arrangement ending, and deleting loses a checklist that took a while to get right.

### The `board_cards` migration

0044 copies every existing card into `work_items` with `source_key` of
`board_card:<id>`, mapping `column_key = 'delivered'` to `state = 'done'`. Guarded
on the absence of any such key so re-running the migration cannot duplicate them.

**`board_cards` is deliberately not dropped.** Dropping it is a later, considered
act, once the new page has been used in anger. `/api/cron/purge-clients` still
deletes from it on client purge, which is correct while it exists.

## 1.3 The four generators

All in `src/lib/work-generate.ts`, run by `generateWorkItems()`. Each builds a
list of candidate rows; `insertMissing()` inserts them **one at a time**, treats
Postgres `23505` (unique violation) as the expected outcome rather than an error,
and logs anything else. One at a time, so a single duplicate does not lose the
whole batch, which matters when the batch is "everything due today".

`atNine(date)` builds `${date}T09:00:00+10:00`, that is 9am Brisbane.

| Generator | Source and filter | Source key | Due at | `has_time` |
|---|---|---|---|---|
| `fromInvoices` | `invoices` where `status = 'sent'` and `due_date` is set | `invoice:<id>:soon` / `:due` / `:overdue7` / `:overdue30` | 9am today, except `:soon` which is 9am on the due date | false |
| `fromReports` | `reports` where `status = 'draft'` | `report:<id>:draft` | 9am today | false |
| `fromCrmSends` | `crm_organisations` where brand is ironpeak, `send_approved_at` and `scheduled_send_at` both set, stage in `queued`/`contacted`/`bounced`, scheduled within the next 24 hours | `crm_send:<id>:<YYYY-MM-DD of the scheduled time>` | the scheduled time itself | **true** |
| `fromCrmTasks` | `crm_tasks` where `done_at` is null and `due_on <= today` | `crm_task:<id>` | 9am on `due_on` | false |

### `fromInvoices`, four stages

Computed from `days = today - due_date`, first match wins:

- `days >= 30` → "INV-0042 is a month overdue, {client}", detail says to pick up
  the phone rather than send another email
- `days >= 7` → "Chase INV-0042, {client}"
- `days >= 0` → "INV-0042 is due, {client}"
- `days >= -3` → "INV-0042 falls due soon, {client}", dated to the due date

Only `status = 'sent'` invoices qualify, so marking one paid or void removes it
from the generator entirely. Brand is hardcoded `hartwell` on every invoice item.

### `fromReports`

Any report sitting in `draft` raises "Finish and send {title}", so a month's work
does not quietly not happen.

Note the divergence from the spec: `docs/dashboard-spec.md` proposed "day 1 of the
month, per retained client". What shipped is "any draft report, every day". That
is arguably the better rule, because it needs no notion of a retained client to
maintain, and the monthly-report-should-exist case is covered by a recurrence
instead. Recorded here so the spec table is not read as a description of the code.

### `fromCrmSends`

**Approved only, deliberately.** An unapproved record is not work yet, it is a
decision Kyle has not made, and the composer is where that decision belongs. It
also means the Microsoft 365 tenant block suppresses these on its own: nothing
gets approved, so nothing appears.

These are the only generated items carrying `has_time`, because 08:47 is the
whole point of the send schedule. That also makes them the only ones the timed
nudge fires for.

The stage filter is `queued`, `contacted`, `bounced`, matching the CRM rule that
`bounced` is not terminal. Anything filtering CRM records for sending must
include all three; that filter has been too narrow three times and the symptom
was silence, not an error.

### `fromCrmTasks`

Follow-ups, LinkedIn connects, re-verifies and annual reviews: the CRM's own task
list, due today or earlier. Brand is hardcoded `ironpeak`.

This is the generator that replaced the nagging. `/api/cron/crm-reminders` no
longer inserts a notification per due task. It still books re-verify tasks when a
prospect's evidence goes stale, which is the half worth keeping, because a fault
cited in an email that has since been fixed destroys credibility.

### What has no generator

`source_kind = 'notification'` is in the check constraint and in
`SOURCE_LABEL` (`src/lib/work-shared.ts`) but **nothing creates one**. The spec
proposed generating a work item on insert of an admin-targeted notification; that
never shipped. Not a fault, just do not go looking for the code.

## 1.4 Recurrence generation

`materialiseRecurrences()` in `src/lib/work-recurrence.ts`.

For each `active` recurrence: compute `nextDue()`, subtract `lead_days` to get
`appearFrom`, skip if that has not arrived, skip if `last_made_on` already equals
that due date, otherwise insert the item and stamp out its steps.

Two dedup mechanisms working together:

- `last_made_on` is the cheap one, so a daily cron running twice makes one item.
- The source key `recurring:<id>:<due date>` is the real one. Next month is a
  different key, so it is not blocked by this month's item still being open.

Ordering matters and is deliberate: the item is created first, its steps second,
and `last_made_on` written **last**. A failure halfway leaves the recurrence able
to try again rather than believing it is done. On a `23505` (the item already
exists for that date) it still writes `last_made_on`, so the next run skips
cheaply.

## 1.5 Reading the list

Pure helpers in `src/lib/work-shared.ts`, shared by the server data layer and the
client components so both agree.

- **`bucketFor()`** returns `overdue`, `today`, `later` or `someday`. No due date
  is `someday`, and that is a real answer rather than a fallback: an item with no
  date is work Kyle intends to do and has not scheduled, and putting it in Today
  because it has nowhere else to go is how a list stops being trustworthy.
- **`isSnoozed()`** is checked **on read**, not by a job that flips state back, so
  a snooze can never be lost to a cron that did not run.
- **`compareWork()`** orders: positioned items first in their order, then anything
  with a clock by that clock, then by due date, then title. `position` null sorts
  last rather than as zero, because a drag writes `position` on one row and leaves
  the others alone.
- **`daysOverdue()`** counts whole days from the start of each day.

`listWork()` in `src/lib/work.ts` does three plain reads (items, steps, client
names) and stitches them, rather than one embedded join. The join would be one
round trip and would make step ordering a property of the query; three plain
reads are easier to keep correct.

`getWorkStrip()` produces the six numbers above the list. **Every figure is
counted from the system that owns it**, not derived from whether a work item
happens to exist: money owed is a fact about invoices, and reading it from
whether a chase item exists would make the figure depend on whether a cron ran.

## 1.6 The views

One page, `/admin` (`src/app/admin/page.tsx`), four tabs over the same rows
(`src/components/work/WorkDashboard.tsx`). `export const dynamic = "force-dynamic"`:
nothing is cached, because a list of what to do next that is thirty seconds stale
is a list that gets doubted, and doubting it is the end of using it.

- **Today** (`TodayList.tsx`) answers "what next". Overdue, then Today, then Later
  (collapsed), then Someday (collapsed). **Only the Today group is draggable**:
  ordering a day is a real decision that sticks, ordering next Thursday is
  arranging furniture in a room nobody is in yet. `reorderWork()` rewrites
  positions for the whole visible group rather than the moved row, because a
  single position among nulls is ambiguous the moment a second item moves.
- **Board** (`WorkViews.tsx`) answers "where is everything". Three columns, Now /
  Next / Someday, **derived from the date rather than stored**. The old board had
  a `column_key` Kyle dragged between, which meant a card's state and its due date
  could disagree and neither was wrong. Here the column is the date.
- **Calendar** is a fortnight, not a month. A month view of a solo operator's work
  is mostly empty squares, and the question a calendar answers here is "is Thursday
  already full".
- **Done** (`DoneList.tsx`) shows the last fifty closed rows, done and dropped
  separately, dropped ones with their reason. Every row has **Put it back**. Two
  reasons it exists: a tick that makes something vanish with no way back is a tick
  nobody makes confidently, and "why is this not on the list" has no answer if the
  row is gone.

The "still doing this?" panel sits above everything on Today: any item overdue
seven days or more with `asked_at` null. Answering calls `acknowledgeWork()`,
which sets `asked_at` and nothing else, and it never returns. Snoozing clears
`asked_at`, because "yes, later" is a fresh decision and the question is allowed
back if it lapses again.

## 1.7 What Done does, and the two refusals

`completeWork()` in `src/app/admin/work/actions.ts`.

**The rule: a tick may never fabricate a record with legal or financial weight.**

| Source kind | What Done does |
|---|---|
| `manual`, `report`, `recurring`, `notification` | Closes the item. Nothing else exists to update |
| `crm_task` | Closes the item **and** sets `crm_tasks.done_at`, so the reminder cron does not raise it again tomorrow. Harmless and reversible |
| `crm_send` | **Refused.** "Sends are logged where they happen. Open the record, send it, then confirm there." |
| `invoice` | **Refused.** "Invoices are marked paid on the invoice, not here." |

Why those two and no others:

- The **touch log is the Spam Act defence**. Under inferred consent, the record of
  what was actually sent, to an address the business itself conspicuously
  published, is the whole legal position. Evidence of something that did not
  happen is not evidence, and worse than none. The only path that writes a touch
  is `confirmSent` on the record itself, after Kyle has pressed send in Outlook.
- **Paid means money arrived.** Nothing else. A checkbox among twelve on a list is
  not where that gets decided.

The refusal is deliberate friction on exactly the two paths where being wrong is
expensive. `needsConfirmation()` in `work-shared.ts` is the shared predicate, and
`WorkItemRow.tsx` uses it to style the tick differently and to render the refusal
message with an "Open it" link built from `sourceHref()`.

**A refusal does not close or hide the item.** It stays open and will be raised
again by the next generator run, which is correct: the work is genuinely not done.

## 1.8 The crons

| Route | Schedule | Runs where | Does |
|---|---|---|---|
| `/api/cron/work` | hourly (intended) | **cron-job.org**, not Vercel | generate, materialise recurrences, nudge |
| `/api/cron/brief` | `0 21 * * *` = 7am Brisbane | Vercel (`vercel.json`) | generate, materialise, then one notification |
| `/api/cron/crm-reminders` | `0 22 * * *` | Vercel | books re-verify tasks only |
| `/api/cron/overdue` | `0 8 * * *` | Vercel | invoice due-soon and overdue emails |
| `/api/cron/recurring` | `0 6 * * *` | Vercel | materialise and auto-send recurring invoices |

All are gated by `cronAuthorized()` in `src/lib/cron-auth.ts`, which **fails
closed**: a missing `CRON_SECRET` returns 503, never "allow". With the secret set,
only `Authorization: Bearer <CRON_SECRET>` gets through.

Vercel Hobby caps its own crons at once daily, which is why the hourly work cron
is external. **Confirm this is actually configured on cron-job.org.** It is listed
as still open in `docs/dashboard-spec.md` and cannot be verified from the
repository. Without it the generators only run once a day, inside the brief.

### The morning brief

`/api/cron/brief` generates and materialises **first**, so the brief describes
today rather than yesterday. If the hourly cron has already run, generating again
makes nothing, because the unique index sees to it.

It then filters out snoozed items, buckets the rest, and **returns silently when
nothing is overdue and nothing is due today**. A brief that arrives every day
regardless is the thing being replaced. Otherwise it inserts one notification per
admin: a title like "3 due today, 2 overdue, 1 to decide on", a body naming the
first three items, linking to `/admin`, type `work_brief` (added to the
`notifications` type constraint by 0045), channel `instant`.

Naming the first three is deliberate. "7 things due" is a number; "Send Kennewell"
is a thing you can picture doing.

### The timed nudge

`nudgeTimedItems()` in `src/lib/work-nudge.ts`, called only from
`/api/cron/work`.

Selects open items with `has_time = true`, `nudged_at` null, and `due_at` in a
window running from **60 minutes ago to 10 minutes ahead**. The window looks
backwards because the cron runs on the hour and a send at 08:47 must be announced
on the 09:00 pass rather than missed for being in the past.

One notification per admin per item, then `nudged_at` is stamped **after** the
send, so a failure part way leaves it to try again rather than believing it was
announced. Without `nudged_at` the hourly cron would announce the same 08:47 send
every hour, which is the nagging again in a different hat. That is why 0046
exists: the nudge was in decision 15 of the spec, only the brief shipped, and the
column had to come with it.

In practice the only items with `has_time` are Ironpeak sends from `fromCrmSends`
and manual items where Kyle typed a time in `NewWorkForm`.

## 1.9 Timezone handling, and where it disagrees with itself

The portal's business timezone is `Australia/Brisbane` (no daylight saving), and
`TZ` is exported from `work-shared.ts` for display formatting.

Three different ways of deciding what day it is currently coexist:

| Code | Method | Effective timezone |
|---|---|---|
| `generateWorkItems`, `getWorkStrip` | `now.toISOString().slice(0, 10)` | **UTC** |
| `atNine()`, `NewWorkForm`, the snooze date picker | literal `+10:00` offset | Brisbane |
| `nextDue()` in `work-recurrence.ts` | `d.setHours(9, 0, 0, 0)` | **server local**, which is UTC on Vercel |
| `/api/cron/recurring` | `Intl.DateTimeFormat` with `timeZone: "Australia/Brisbane"` | Brisbane, correctly |

The recurring invoice cron gets this right and documents why. The work generators
do not. Consequences are in section 1.10.

## 1.10 Known problems in the work system

These are real, checked against the code, and none of them is recorded anywhere
else.

### Dropping a generated item does not suppress it

`docs/dashboard-spec.md` (decision 2, and again under "The five questions") and
`CLAUDE.md` both say that Not doing suppresses one stage: drop
`invoice:<id>:overdue7` and `:overdue30` still arrives three weeks later.

The first half of that is not what happens. The unique index is partial on
`state = 'open'`, so a **dropped** row stops blocking its own key. `fromInvoices`
recomputes the stage from the invoice's current age on every run, and an invoice
ten days overdue produces `invoice:<id>:overdue7` on every pass for the next
twenty-three days. Nothing in `insertMissing()` consults dropped or done rows. So
Not doing removes the item for at most one hour.

The same applies to `report:<id>:draft` (regenerated while the report is still a
draft, and `report` is a kind `completeWork` **allows**, so ticking it off is also
undone within the hour) and to `crm_send` (regenerated while the record stays
approved, scheduled and in an open stage).

`crm_task` is the one kind that behaves as documented, and only because
`completeWork` also writes `crm_tasks.done_at`, which takes it out of the
generator's filter.

The practical effect: for three of the four generators, the only way to stop an
item returning is to change the underlying fact (mark the invoice paid or void,
publish the report, log the touch or withdraw the approval). That is defensible
behaviour, but it is the opposite of what the UI promises. `DoneList.tsx` tells
Kyle that Not doing "closes it for good".

Two ways out, with a real trade-off between them:

- Make the index non-partial: `unique (source_kind, source_key)` with no `where`
  clause. Because the key already carries the stage, `:overdue30` remains free to
  arrive. The cost is that a report ticked done and then reopened as a draft never
  raises an item again.
- Or have `insertMissing()` skip a key that already has a `dropped` row, and leave
  `done` free to regenerate. More code, but it separates "I dealt with this" from
  "I am not doing this", which is the distinction the two buttons already make.

Either way, decide it deliberately and update both this document and the spec.

### The brief classifies items it has just created as overdue

`generateWorkItems` derives `today` from `now.toISOString()`, which is UTC. The
brief runs at 21:00 UTC, which is 07:00 Brisbane on the **following** day. So at
brief time, `today` is yesterday's Brisbane date, and every invoice, report and
CRM task item created on that pass gets `due_at = atNine(yesterday)`, that is
09:00 Brisbane yesterday.

`bucketFor()` then puts them in **Overdue**, and `daysOverdue()` reports 1. The
first brief of an invoice's life announces it as already late, and the Overdue
group on Today is polluted with items generated during any Brisbane pre-10am run.

The fix is the one `/api/cron/recurring` already uses: compute the business date
through `Intl.DateTimeFormat` with `timeZone: "Australia/Brisbane"` rather than
slicing an ISO string. `getWorkStrip()`'s overdue-money comparison has the same
ten-hour lag and the same fix.

### Recurrences land at 7pm Brisbane

`nextDue()` uses `setHours(9, 0, 0, 0)` in server-local time. On Vercel that is
09:00 UTC, which is 19:00 Brisbane. Every recurring item is therefore due at seven
in the evening, sorts after everything else on the day, and reads as "later
today" for most of the working day. `atNine()` in the generator has this right;
`nextDue()` does not.

### Orphaned components

`src/components/admin/ProjectBoard.tsx` and `src/components/admin/ProjectCalendar.tsx`
still exist and still speak `board_cards`, but nothing imports either of them.
They are dead code. Removing them is the natural companion to eventually dropping
`board_cards`.

### Smaller notes

- `deleteWork()` hard-deletes, behind a `window.confirm`. It is the only
  destructive path in the work system, and it exists because a mis-created item is
  noise, not history.
- Hours are logged per item and read nowhere else. Pulling unbilled hours onto an
  invoice was deliberately decided against for now.
- Rescheduling a CRM send to a different **day** changes its source key, so the
  old item stays open alongside the new one until it is closed by hand.

---

---

# PART 2 — DOCUMENTS: INVOICES AND REPORTS

This is the money path. Precision matters more than breadth here, and so does
failing loudly.

## 2.1 The shared document model

Invoices and reports are different tables with a deliberately shared shape:

| Concern | Invoice | Report |
|---|---|---|
| Brand | `invoices.brand` (0023) | `reports.brand` (0030) |
| Recipients | `invoices.recipient_user_ids` (0031) | `reports.recipient_user_ids` (0032) |
| Covering email | `invoices.email_message` | `reports.email_message` (0032) |
| PDF | `pdf_path`, `pdf_name`, `pdf_uploaded_at` (0043) | same three (0042) |
| Send stamp | `sent_at` first, `last_sent_at` latest (0033) | `sent_at` |
| Storage | bucket `pulse-reports`, key `{client_id}/{doc_id}/pdf/...` | same |
| Renderer | `src/lib/pdf-render.ts` | same |
| PDF card | `src/components/documents/DocumentPdf.tsx` | same |
| Recipient rule | `src/lib/recipients.ts` | same |

The `pulse-reports` bucket is private and named for what it was built for rather
than what it holds. Renaming it would break every stored report path for no gain.
Storage RLS requires the `client_id` as the first path segment, which both
document types satisfy.

**One component for both kinds wherever the behaviour is the same.** Two would
drift, and the first sign of drift would be one document type quietly losing a
safeguard the other kept.

## 2.2 Branding

`src/lib/brand.ts` is the single source. It exports `IRONPEAK`, `HARTWELL`,
`isIronpeak()` and `IRONPEAK_DOC_CLASS = "doc-light brand-ironpeak"`.

The rules, none of which are cosmetic:

- **Ironpeak Consulting is a registered business name against Hartwell Digital's
  ABN 44 286 503 049.** Same legal entity, same ABN, one shared invoice number
  sequence. Internal surfaces may say Hartwell is the parent; **client-facing
  output must not**. No "a business of Hartwell Digital", no dual logos. The bare
  ABN line is the only permitted expression of the parent, and it needs no
  explanation. No phone number on any client-facing Ironpeak document.
- **`doc-light` flips the document to a white sheet.** Ironpeak's brand is
  near-black, and a dark document is hostile to print, burns toner and reads as a
  novelty rather than something official.
- **`brand-ironpeak` brings the typography**: Clash Display for the wordmark and
  headings, Hanken Grotesk for body, Geist Mono for figures. Both classes are
  scoped so nothing leaks onto a Hartwell surface.
- **A document must never hardcode a colour.** Chart strokes, bars and fills read
  `--pulse-gold`, which `doc-light` swaps for steel. That is what lets one
  component serve both brands with no prop threaded down to it.
- **The letterhead renders on screen and in print, deliberately.** A print-only
  letterhead means the first time anyone sees the branded document is after it has
  been sent.
- **Never re-declare Ironpeak's details in a component.** They live in
  `brand.ts`.

`src/components/invoices/InvoiceDocument.tsx` is the reference implementation:
`ironpeak && IRONPEAK_DOC_CLASS` on the container, `IronpeakWordmark` in place of
`Wordmark`, ABN read from `business_settings` rather than from `brand.ts` because
it belongs to the entity, not the brand.

`setReportBrand()` in `src/app/admin/reports/actions.ts` checks its write and
names migration 0030 in the failure message, because a brand column that has not
been migrated is exactly the shape of the $0.00 invoice incident.

## 2.3 Recipients: one rule, one implementation

`resolveRecipients()` in `src/lib/recipients.ts`. Invoices, reports, the due-soon
heads-up and the overdue chase all route through it. `invoiceRecipients()` in
`src/lib/invoices-send.ts` is a thin wrapper so invoice callers share a signature.

**The rule, in two halves, and both halves matter:**

1. **An empty `recipient_user_ids` means EVERYONE on the account.** Not nobody.
   Every invoice predating 0031 and every report predating 0032 carries an empty
   array, so adding the column changed no existing behaviour, and it stays the
   right answer for a one-contact client who should never have to configure
   anything.
2. **An empty RESULT means STOP.** A chosen id that has left the account drops
   out, and if that empties the list the send **throws or refuses** rather than
   falling back to everyone. Falling back would email precisely the person who was
   deselected.

The query filters `role = 'client'`, so an admin is never a recipient of a client
document.

**A fourth caller writing its own `client_users` query is how these drift apart.**
If you add a path that emails a document, call `resolveRecipients`.

Two related behaviours:

- A new invoice **inherits the last non-void invoice's recipients** for that client
  (`createInvoice` in `src/app/admin/invoices/actions.ts`). Billing a two-person
  account usually means billing the same one of them each month. It is a starting
  point only: `RecipientPicker` shows everyone on the account, so a new contact is
  visibly unticked rather than silently left out.
- The **recurring cron copies the template's** `recipient_user_ids` onto every
  invoice it generates. Without that, an automated monthly invoice would quietly
  go wider than the one it was modelled on.

`RecipientPicker.tsx` says "everyone on the account" in words rather than leaving
an empty state to be interpreted, shows email addresses rather than just names
(the question being answered is which inbox this lands in), and collapses to a
plain statement when the account has one contact.

## 2.4 The invoice: statuses, numbering, money

Statuses are `draft`, `sent`, `paid`, `void`.

- **`draft`** may be edited and deleted freely.
- **`sent`** may be edited, corrected and reissued under the same number. It may
  be marked paid or void.
- **`paid`** and **`void`** are **fully locked** in `saveInvoice`, not just in the
  UI: "a rule that lives only in a disabled button is not a rule". Paid can be
  reopened to `sent` from the UI; void has no way back by design.
- **A sent invoice is never hard-deleted.** `deleteInvoice` reads the stored
  status and refuses anything but a draft. Void, not delete: it keeps the number
  and the audit trail, and the ATO expects five years of records.

**Numbering** comes from `next_invoice_number()` (migration 0009), a
`security definer` function over a real sequence returning `INV-0001` style
strings. `count(*) + 1` races the moment a machine issues numbers and breaks when
drafts are deleted. Gaps in invoice numbers are fine; collisions are not. Both
brands share the sequence: one business, one set of books.

**Money maths** is in `src/lib/invoices-shared.ts`, `computeTotals()`:

- **Discounts are negative line items.** Positive amounts make the subtotal;
  negative amounts sum into a discount, which is capped at the subtotal so a total
  can never go negative. The document shows the discount lines in the table and a
  netted Discount row in the totals.
- Rounding is to cents at every step, via `Math.round((n + Number.EPSILON) * 100) / 100`.
- **GST modes**: `add` (10% on the net), `inclusive` (backed out of the net), and
  `none`. `gstLabel()` renders "GST (10%)", "Includes GST" or "No GST".
- `InvoiceDocument` heads the page "Tax Invoice" only when `gst_mode !== 'none'`.
- **`deposit_amount`** (0023) is money already received. It does **not** reduce
  `total`, which stays the contract value; the document shows an amount due of
  `total - deposit`.

**Kyle is not registered for GST, so invoices should be "No GST".** Note carefully
that this is a *setting*, not a code default: `business_settings.gst_mode` defaults
to `'add'` in the schema (0004), `createInvoice` falls back to `'add'`, and
`SettingsManager`'s local placeholder state is `'add'`. The no-GST behaviour holds
entirely because the live `business_settings` row says `none`. See Risks.

Everything is AUD and en-AU formatted (`formatMoney`, `toLocaleString("en-AU")`).

## 2.5 Amend and reissue under the same number

Migration 0033. This is the most subtle part of the invoice system.

**The problem it solves.** A sent invoice used to be frozen. Fixing a wrong one
meant voiding it and raising a new number, which leaves the client holding two
documents for one job and a gap in the sequence to explain. For an **unpaid**
invoice, correcting it and reissuing under the same number is the ordinary thing
to do.

**What must never happen is a silent change.** If Daryl was emailed INV-0012 for
$170 and it quietly becomes $150, "what did he actually receive, and when" has no
answer.

So three columns and one table:

| Field | Meaning |
|---|---|
| `revision` | 0 as first issued. Bumped when an already-sent invoice is saved |
| `sent_at` | The **first** send. Never moves. This is when the invoice was issued |
| `last_sent_at` | Carries the resends |
| `invoice_sends` | One row per send, snapshotting what went out |

`invoice_sends` holds `revision`, `total`, `due_date`, `sent_to` (the actual email
addresses) and `kind` (`send` or `resend`). **Snapshotted, not joined.** A later
correction is exactly the thing that would otherwise rewrite this history.
Addresses rather than user ids, so the record survives someone leaving the
account. Admin-only under RLS: it is Kyle's record of what went out.

0033 backfills one row per already-sent invoice so the history does not start
empty, and sets `last_sent_at = sent_at` for those.

**The client-facing consequence:** `sendInvoiceWith` chooses the noun from the
revision. `revision > 0` gives "Updated invoice INV-0012"; otherwise "New invoice
INV-0012". Calling a correction a new invoice makes a client think they owe twice.

`SendHistory.tsx` renders the whole log under the invoice, and `LastSent.tsx`
renders the most recent line at the top, because the full history sits below the
fold on a long invoice and that put the answer to "did that actually send" in the
one place nobody was looking.

**Caution:** `revision` is bumped on every save of a sent invoice, with no check
that anything changed, and the UI saves before every test and every resend. See
Risks: this makes an unchanged resend announce itself as an updated invoice, and
it makes "Test to me" mutate the stored row.

## 2.6 Sending an invoice, step by step

`sendInvoiceWith()` in `src/lib/invoices-send.ts`. Takes any Supabase client, so
the manual Send button (RLS server client) and the recurring cron (service role)
share one path.

Order of operations, and the order is the design:

1. Read the invoice, the client name, the business settings and the recipients.
2. Build the message body from `invoice.email_message`, falling back to
   `business_settings.invoice_email_message`, falling back to
   `DEFAULT_INVOICE_EMAIL`. Placeholders `{client}`, `{invoice}`, `{amount}`,
   `{due date}` are filled by `renderMessage()`, which **HTML-escapes the template
   and every value**, so a client name with an ampersand cannot break or inject
   into the email.
3. **Download the PDF if `pdf_path` is set.** Nothing is rendered here (2.9).
   A download failure logs a warning and the send **continues**.
4. Choose the noun from `revision`, and add a sentence saying the invoice is
   attached. That line is said by the sender rather than written into the
   template, because whether there is a PDF is a fact about this send and the
   template is Kyle's words.
5. If `testTo`: send one email and **return**. No notification, no status change,
   nothing recorded. The test carries the attachment, because a proof that leaves
   out the thing being changed is not a proof.
6. If the resolved recipient list is **empty, throw**. The invoice stays a draft.
7. For each recipient: insert an in-portal notification, then email them if they
   have an address, collecting the addresses that were actually used.
8. **Write the `invoice_sends` row before flipping the status**, so a send that
   half succeeds still leaves evidence of what reached an inbox.
9. Optionally notify admins (`adminNotice`), used by the recurring cron so a
   machine never bills a client silently.
10. **Flip to `sent` last**, setting `sent_at = invoice.sent_at ?? now` and
    `last_sent_at = now`. A hard failure mid-send leaves the invoice a draft, and
    the recurring cron re-attempts an existing unsent invoice rather than skipping
    it.

The UI (`InvoiceBuilder.tsx`) adds guards on top:

- A $0.00 total asks for confirmation, because "that usually means the line items
  have not saved".
- The confirm dialog **names every recipient with their address**. A confirm that
  says "the client" is how an invoice reaches someone it was never meant for.
- Save always happens before send, test or resend, so what goes out is what is
  stored.

`resendInvoice()` refuses anything that is not `sent`, resolves recipients up
front so it can report who it went to, and passes `resend: true` so the
`invoice_sends` row is labelled correctly.

## 2.7 Recurring billing

`/api/cron/recurring`, daily at 06:00 UTC.

A **template** is an ordinary invoice row with `recurring_active = true`. It is
never sent itself. Each day the cron materialises and auto-sends one real invoice
per due template per month.

- **"Due" means the billing day has arrived** (`anchor <= today`), not "is today",
  so a missed cron day self-heals on the next run. It will not back-bill a period
  whose billing day predates the template's own `issue_date`.
- `recurring_anchor_day` is constrained to 1..28 so February never skips.
- **Dates are evaluated in Brisbane** via `businessToday()`, so a billing day
  matches what Kyle set regardless of the cron's UTC runtime.
- **The anti-double-billing guarantee** is the unique index
  `(recurring_source_id, recurring_period)` from 0009. A duplicate insert returns
  `23505`, which is treated as "already billed this month". If the existing
  invoice for that period is still a draft, the cron **finishes the send** rather
  than skipping, which recovers a prior run that created but never sent.
- **Lifecycle guard:** a client that is `paused` or soft-deleted is never billed.
- `recurring_terms_days` (0029) lets one retainer bill on different terms from
  everything else. Null means use the business default.
- **Service period tokens.** `{service_start}`, `{service_end}` and
  `{service_period}` are substituted into notes, the email message and every line
  item's title and description, so a description written once stays true each
  cycle. A monthly period runs from the billing day to the day before the next
  one: billed on the 6th, the period is 6 August to 5 September.
- The cron **renders the PDF before sending** (`tryRenderPdf`) and never lets a
  render failure stop the send. It can do this because it is a route handler with
  `maxDuration = 60`.

`ScheduledInvoices.tsx` on `/admin/invoices` pulls the templates out of the list,
because the thing that will quietly charge a client next Tuesday looks identical
to a one-off from March in a list sorted by creation date.

## 2.8 Reports

### Publish and send are separate acts

**Publish makes it visible. Send emails the chosen people and stamps `sent_at`.**

Migration 0032 dropped the `reports_notify` trigger that used to put a line in
everyone's **weekly digest** on publish. A finished report could sit unmentioned
for six days, it went to every person on the account whether or not it was meant
for them, and nothing recorded that it had gone.

`sendReportWith()` refuses to send a report that is not published, because a
client cannot open a draft and the email would arrive with a link to nothing. The
exception is `testTo`, which is allowed on a draft: **checking a report is right
is what you do before the client can see it**, and making publishing the price of
a test had that backwards.

The report send notification uses `channel: "instant"` with `emailed_at` already
set, so the weekly digest does not repeat it.

`sent_at` is stamped **last**, so a failure part way through leaves it looking
unsent and Kyle sends again rather than believing it landed.

### `SendReportResult` reports the attachment by name

`{ ok: true, sentTo, attached }` where `attached` is the filename or null. That
exists so a test send can say which of the two emails it was. "It looked fine" is
not an answer to "did the attachment go", and that is the whole question a test
is asked.

### The body is a closed Markdown subset

`src/components/reports/ReportText.tsx` is a hand-written renderer, **not a
library**, so nothing in a report body can inject markup. It supports:

paragraphs, `- ` bullets, `1. ` numbered lists, `### ` subheadings, pipe tables
(the header needs a `|---|` divider row), `**bold**`, and four fenced blocks:
` ```stats `, ` ```bar Title `, ` ```compare Title ` and ` ```note Title `.

The fences exist because a column of numbers in a table is data and a report is
meant to make a point. Numbered lists render as `<ol>` and take their numbers from
position, so inserting a step does not mean renumbering the rest. **The one
exception is the first item**: start it at 4 and the list starts at 4, which is
how recommendations split under two subheadings stay one sequence. `note` is one
style rather than a light and a dark variant, because two boxes competing for the
same job is a decision to make on every callout for no gain.

### Import, summary, placeholders

`importReportMarkdown()` takes a Markdown draft as written. A leading `# ` is the
report's title; each `## ` starts a section; **everything above the first `## `
becomes `reports.summary`**, which is where the title block and the at-a-glance
table naturally sit. Horizontal rules are stripped, because the section cards
already provide that separation. It refuses if a report already exists for that
client and month, and it deletes the report if the sections fail to insert rather
than leaving a shell behind.

`reports.summary` was written by the importer and rendered by nothing for its
whole life. It renders now, as "Opening", above the first section
(`ReportDocument.tsx`). **If a report field exists, check something actually
displays it.**

`findPlaceholders()` in `src/lib/reports-shared.ts` scans the summary and every
section body for `[bracketed notes]`, TODO, TBC, TBD, XXX and FIXME, skipping
anything that is really a Markdown link. The editor shows them in the send
confirmation, because a report is written before all its numbers are in, and the
one moment the gaps will not be found again is the moment of sending.

### Editor behaviour worth knowing

- **Every body field has a live preview beside it**, rendered by the document's
  own `ReportText` with the document's own styles, so what is shown is what
  prints. It is **one setting for the whole editor**, owned by `ReportEditor` and
  kept in `localStorage` under `pulse.report.preview`, because the answer was the
  same on every section of every report. It lives in storage rather than on the
  report row or the user because it describes how a browser window is being used,
  should not travel between machines, and should not be something a save can
  conflict over. It starts off and corrects itself on mount, since reading storage
  during the first render makes server and client disagree about what to draw.
- **`report-page-break`** on a section starts a new page in print. It is stored in
  the section's JSON `content`, which is why it needed no migration. CSS can stop
  a heading being orphaned; it cannot know that a section is a new chapter, so
  that is a switch rather than a heuristic.
- **Deleting a report** is drafts only, checked on the stored row, mirroring how a
  sent invoice is voided rather than deleted. Sections cascade; uploaded images
  are swept by hand, because an orphaned file in a private bucket is invisible and
  pays rent forever.
- **The tab title is the suggested PDF filename**, `{client} - {title}`, on both
  the client viewer and the admin preview. A file called "Report preview.pdf"
  reaching a client is a mistake.

## 2.9 PDF generation

### One renderer

`src/lib/pdf-render.ts`, `renderAndAttach()`. Reports and invoices need the
identical thing: launch Chromium, force the light theme, open a signed print
page, take an A4 PDF, upload it, point the row at it. Two copies of a headless
browser launch would be two places for the theme seeding, the wait condition and
the page size to drift apart, and the first sign of that would be one document
type printing correctly and the other not.

`src/lib/report-pdf.ts` and `src/lib/invoice-pdf.ts` are thin wrappers supplying
the table, the client id and the filename.

Details that are load-bearing:

- **Chromium is imported inside the function**, not at the top, so ~67MB is only
  touched by a request that needs it. `serverExternalPackages` must keep
  `@sparticuz/chromium` and `puppeteer-core` out of the bundle, or the executable
  never arrives and the launch fails on a path that does not exist.
- **The theme is seeded with `evaluateOnNewDocument` before navigation.** The
  portal defaults to dark and a fresh headless profile has no theme stored.
  Setting it afterwards would flash and would not repaint what was already drawn.
  `ForcePrintLight` on the print page states the palette a second time, with no
  media query and no layer, because the `@media print` block alone was not enough
  in practice.
- **`waitUntil: "networkidle0"`**, not `load`. The letterhead and any screenshots
  are signed Storage URLs fetched after first paint, and a PDF taken before they
  land has holes in it.
- **`preferCSSPageSize: true`.** `globals.css` already sets
  `@page { margin: 18mm 16mm }`; passing a second set of numbers would give the
  document two answers to one question.
- **Two filenames, deliberately.** `documentNames()` returns a display name with
  only the characters a filesystem genuinely refuses removed, and a separate ASCII
  storage key. They used to be one string, and sanitising it for storage is what
  turned "Haús of Vitality" into "Haus of Vitality" on a document addressed to
  her.
- **The row update is checked, and rolls back the upload if it fails.** An
  unchecked write here leaves the new file in storage while the row still points
  at the old one, and the next send carries a document that has since changed. The
  previous object is removed **only after** the row points at the new one.

### The print pages and the signed token

`/print/report/[reportId]` and `/print/invoice/[invoiceId]` are public in
middleware and carry their own check: an HMAC token in `src/lib/print-token.ts`,
scoped to that one id, good for five minutes, signed with `CRON_SECRET`.

**The kind is signed alongside the id**, so a token minted for a report cannot be
pointed at an invoice. Both print routes are public and that signature is the only
thing between them and the world. Invalid tokens get `notFound()` rather than a
message, so an unsigned request cannot learn whether the id it guessed exists.

`CRON_SECRET` rather than a variable of its own: it is already required, already
server-only, and already the shared secret this deployment uses to prove a request
came from itself. One more environment variable that silently disables a feature
when unset is the worse trade.

The print pages render the **same** `InvoiceDocument` and `ReportViewerChrome`
the client sees, using service-role Supabase because there is no session to scope
RLS with. A print-only twin would be two documents to keep in step, and the PDF
would drift from the portal the first time only one changed. That matters most on
an invoice: the attachment and the portal have to agree on the amount.

### Where rendering may and may not happen

**NOTHING renders inside a server action. Ever.** An action inherits the calling
page's ten seconds on Hobby and a cold Chromium start does not finish in ten. The
invoice send did render, once, and pressing Send hung and died with a blank
screen. Rendering happens only in route handlers, which set
`runtime = "nodejs"` and `maxDuration = 60`:

- `POST /api/invoices/[invoiceId]/pdf`
- `POST /api/reports/[reportId]/pdf`
- `/api/cron/recurring`

`src/lib/pdf-client.ts` (`requestDocumentPdf`) is the one client-side caller, a
plain fetch, shared so the publish button, the PDF card and the invoice editor
cannot drift into calling it differently. Both routes return **200 either way**: a
failed render is an outcome the editor shows, not an exception, because the
document still sends without it.

**Reports render on publish.** `ReportEditor.publish()` saves, publishes, then
requests the PDF, in that order, because the renderer opens the stored report and
a PDF made before the save would be of the previous version. A render failure does
not fail the publish.

**Invoices render on demand and again on first send.** An invoice has no publish
step to hang it on, so `InvoiceBuilder.send()` calls the route **before** calling
the send action, and only when `pdf_path` is empty.

**Rendering is deliberately off the send path** for reports, and a failed render
leaves the previous PDF alone. The manual upload still works exactly as it did.
Keep it that way.

**The looking stayed manual.** Publishing makes the file and attaches it, and
nothing sends it, so it is still opened and read before Send. The old arrangement
had Kyle print the viewer and upload the file, on the reasoning that a renderer
would attach a document nobody had looked at. That reasoning was kept and the
tedium was not.

**Staleness is shown, not detected.** `DocumentPdf.tsx` compares `pdf_uploaded_at`
against the document's `updated_at` and warns when the PDF is older. Nothing can
tell that from the file itself, so the two timestamps are simply shown to
disagree. On an invoice the warning is sharper, because a reissue under the same
number means the attachment could show a superseded amount.

**Note:** two code comments are now stale on this point. Migration `0042` says
"The portal does NOT make the PDF", and `uploadReportPdf` in
`src/app/admin/reports/actions.ts` says "The portal has no renderer". Both were
true when written and were superseded by `pdf-render.ts`. The migrations are
historical records and should not be edited; the action comment should be.

## 2.10 Attachments: who carries the PDF, and who does not

**Verified by grep across `src`.** `attachments` reaches `sendEmail` from exactly
two files:

| Email | Carries the PDF? | Where |
|---|---|---|
| Invoice send, and resend | **Yes**, if `pdf_path` is set | `src/lib/invoices-send.ts` |
| Invoice "Test to me" | **Yes** | same |
| Report send | **Yes**, if `pdf_path` is set | `src/lib/reports-send.ts` |
| Report "Test to me" | **Yes** | same |
| Invoice **due-soon heads-up** | **No** | `src/app/api/cron/overdue/route.ts` |
| Invoice **overdue nudge** | **No** | same |
| Weekly digest, notification emails | No | `cron/digest`, `cron/email` |

Both reminder emails are hand-built HTML plus a "View invoice" button into the
portal. They resolve recipients correctly through `invoiceRecipients()`, so the
right people get them; they simply carry no file.

**The failure behaviour is deliberately inverted between the two document types:**

- **A report send halts** if its attachment cannot be read, with a message saying
  to upload it again or remove it. A person is standing there to read that
  message, and a send that quietly drops the PDF looks identical to one that never
  had one.
- **An invoice send never stops for a missing PDF.** It logs a warning and goes.
  The recurring cron sends invoices with nobody watching, and an invoice that does
  not arrive is worse than one carrying a link.

### Is the reminder gap worth closing?

**Assessment: yes for the overdue nudge, probably yes for the due-soon heads-up,
and it is a small change.**

The argument for the send carrying the PDF applies with more force to the
reminders, not less. The whole reason 0043 exists is that an invoice goes to
whoever pays the bills, which is often not the person with the login, and a
bookkeeper cannot pay what they cannot open. A reminder is aimed at exactly that
person, and it currently hands them the same sign-in wall the send was changed to
avoid. If the original email is buried or was forwarded to accounts, the reminder
is the one that will actually get acted on.

Two real arguments against, neither decisive:

1. **Deliverability.** `sendEmail`'s own comment notes an attachment is a
   deliverability cost. Sending the same PDF three or four times to one recipient
   over a month is more attachment volume on the `hartwelldigital.com` domain that
   carries every client notification.
2. **Staleness.** The reminders read the invoice fresh but would attach whatever
   `pdf_path` points at, which on a reissued invoice may predate the last
   correction. The send path has an editor and a staleness warning in front of it;
   the cron has neither.

The shape of a fix that respects both:

- Attach on the **overdue** nudge, where the recipient most needs the document in
  hand, and leave the due-soon heads-up as a link, since the invoice itself
  arrived days ago with the PDF on it.
- **Only attach when the PDF is not stale**, that is when `pdf_uploaded_at >=
  updated_at`. A reminder carrying a superseded amount under the same number is
  worse than a reminder carrying a link, and it is the precise failure 0033 exists
  to prevent.
- Reuse the download and `attachedLine` logic from `invoices-send.ts` rather than
  writing a third copy. Better still, lift it into a small shared helper, since
  there would then be three callers.

Until that is done, record it plainly: **the reminders link, they do not attach.**

## 2.11 Email delivery tracking

- Every `sendEmail` writes an `email_events` row (0034), keyed on Resend's own
  message id so a webhook arriving twice updates rather than duplicates.
- The Resend webhook at `/api/webhooks/resend` moves the status along. **Status
  only ever moves FORWARD** through the rank ladder, because webhooks arrive out
  of order and a late "sent" must never overwrite a "bounced".
- Signature verification is hand-rolled in `src/lib/svix-verify.ts` rather than
  pulling in `svix` for one route. The timestamp tolerance is not decoration:
  without it a captured request replays forever.
- **`recordEmail` swallows its own failures after logging.** Telemetry that can
  stop an invoice reaching a client is worse than no telemetry.
- The table is admin-read only under RLS, and writes come only from the webhook
  and the sender, both service role. No insert or update policy is granted to
  `authenticated` at all.
- **"Sent" renders grey, not green.** The gap between "we sent it" and "it
  arrived" is the entire point.
- `deliveryFor()` in `src/lib/email-delivery.ts` matches an event to a send row by
  "the earliest event for that address at or after this send", with a minute of
  slack for clock skew. An email row carries no send id, and giving it one would
  mean the sender knowing about its own audit trail.
- Requires `RESEND_WEBHOOK_SECRET` in Vercel plus an endpoint configured in
  Resend.

**Only the two send paths pass `ref: { kind, id }`.** The reminder emails from
`/api/cron/overdue` do not, so their rows land as `ref_kind: 'other'` and never
appear in an invoice's delivery panel. That is a one-line fix and worth doing at
the same time as the attachment question.

## 2.12 The money rules, restated

These are rules, not observations. Do not weaken them.

1. **Always check the error on a write.** `saveInvoice` did not, a migration added
   a column that had not been applied, PostgREST rejected the whole update
   silently, the invoice kept its defaults, and a client was emailed an invoice for
   $0.00 on the wrong terms. **Adding a column to an existing write is exactly the
   moment this bites**, because code ships before the migration is run.
2. **`recipient_user_ids` empty means everyone; an empty result means stop.**
   Route it through `resolveRecipients()` and nothing else.
3. **A sent invoice is voided, never deleted.** Drafts may be deleted. Paid and
   void are locked in the action as well as the UI.
4. **A sent, unpaid invoice may be corrected and reissued under the same number**,
   and every send writes an `invoice_sends` snapshot so the change is never silent.
5. **`sent_at` never moves. `last_sent_at` carries resends. `revision` bumps on a
   post-send save**, and drives "Updated invoice" versus "New invoice" in the
   subject line.
6. **No GST.** Kyle is not registered. AUD, en-AU formats, "Invoice" not "Tax
   Invoice".
7. **Test to me reads the SAVED row**, not form state, so a proof shows what is
   stored. It records nothing and changes no status.
8. **Never render inside a server action.**
9. **An invoice send never stops for a missing PDF. A report send does.**

---

---

# Open questions

Things this pass could not resolve from the repository.

1. **Is the hourly `/api/cron/work` job actually configured on cron-job.org?**
   Nothing in the repo can answer this, and `docs/dashboard-spec.md` still lists it
   as outstanding. If it is not, the generators run once a day inside the brief and
   the timed nudge effectively never fires, because its window is one hour wide.
   **Check this first.** It is the single point of failure for the whole
   dashboard.
2. **What does `business_settings.gst_mode` actually say in production?** The
   whole "No GST" rule rests on it being `none`, and every default in code and
   schema is `add`. Unverified from here.
3. **Has any recurring template been created with the "no GST" assumption baked
   into stored `gst`/`total` figures rather than into `gst_mode`?** Not checkable
   without the data.
4. **Is `pre_reminder_sent_at` ever reset when an invoice is amended and
   reissued?** It is not, in code. Whether that is intended is a business
   judgement: a reissued invoice with a new due date will never get a second
   heads-up, only the overdue nudge.
5. **What was the intended behaviour for `source_kind = 'notification'`?** The
   constraint and the label exist; no generator does. It may have been dropped
   deliberately once client notifications were declared out of scope, or simply
   not built.
6. **Which admin users exist in `client_users` with `role = 'admin'`?** Both the
   brief and the nudge return early with `{ sent: 0, reason: "no admin" }` if the
   list is empty, silently. Worth confirming once.

---

# Risks and gaps

Ordered by how much they would cost if they went wrong.

### 1. "Test to me" and a plain resend both bump `revision` on a sent invoice

`saveInvoice` bumps `revision` whenever the stored status is `sent`, with **no
check that anything actually changed**. `InvoiceBuilder.test()` and
`InvoiceBuilder.resend()` both call `saveInvoice` unconditionally before doing
their work.

Two consequences on the money path:

- **A test send mutates the stored invoice.** "Test to me" is documented and
  designed to record nothing, and it silently increments the revision. The test
  email itself then reads "[Test] Updated invoice INV-0012".
- **An unchanged resend tells the client the invoice was updated.** The comment in
  `invoices-send.ts` explicitly says "a plain resend of an unchanged invoice still
  reads as the original, which is what it is". Because the UI always saves first,
  that is not what happens: revision goes 0 to 1 and the subject becomes "Updated
  invoice". Telling a client an unchanged invoice has been updated is precisely the
  confusion the revision noun was introduced to prevent, and the `invoice_sends`
  row records a revision that reflects a save, not a change.

Fix: compare the incoming input against the stored row and bump only on a real
difference, or bump in the send path rather than the save path. The second is
simpler and matches what the field means.

### 2. Not doing does not suppress a generated item

Covered in full in 1.10. The UI promises "closes it for good"; the item returns on
the next generator run for `invoice`, `report` and `crm_send`. Decide which of the
two fixes to take and update the spec with it.

### 3. Unchecked writes on two status changes

- `setInvoiceStatus()` in `src/app/admin/invoices/actions.ts` updates status (and
  `paid_at`) with **no error check**. Marking an invoice paid or void is exactly
  the class of write rule 1 in section 2.12 was written about, and a silent failure
  here means an invoice that looks settled on screen and stays `sent` in the
  database, where the overdue cron will keep chasing the client for money already
  received.
- `setReportStatus()` in `src/app/admin/reports/actions.ts` is unchecked the same
  way. A publish that silently fails is followed by a send that refuses, so the
  blast radius is smaller, but it is the same fault.

Both are one-line fixes and both are on paths the project's own rules cover.

### 4. UTC versus Brisbane in the work generators

Covered in 1.9 and 1.10. Freshly generated items read as overdue in the 7am brief,
and recurrences land at 7pm. Neither loses data, both erode trust in the list,
which is the only thing the list has. `businessToday()` in
`/api/cron/recurring/route.ts` is the pattern to copy.

### 5. A resend does not regenerate the PDF

`InvoiceBuilder.send()` renders only when `pdf_path` is empty, and `resend()` does
not render at all. So the ordinary correction workflow (edit a sent invoice, press
Resend) emails the **old** PDF, showing the old amount or due date, under the same
invoice number. That is the exact silent change 0033 exists to prevent.

It is mitigated, not solved, by the staleness warning on `DocumentPdf`, which is a
warning and not a block, and which sits above the builder where it can be scrolled
past. Consider having `resend()` regenerate when the PDF is stale, or having
`sendInvoiceWith` refuse to attach a stale PDF and say so.

### 6. The reminder emails carry no PDF and no `ref`

Covered in 2.10 and 2.11. The missing `ref` is a straightforward bug: those sends
never appear in the invoice's own delivery panel, so "did the reminder arrive" has
no answer in the portal.

### 7. Deleting a draft report leaves its PDF behind

`deleteReport()` sweeps `pulse-reports` with a non-recursive
`list(`${client_id}/${report_id}`)`. Report **images** live directly under that
prefix and are removed. The **PDF** lives one level deeper, under `.../pdf/`, so
`list` returns it as a folder entry and `remove` is handed a path that is not an
object. The PDF is orphaned and pays rent forever, which is the very thing the
sweep exists to prevent. The same applies to any invoice PDF, though invoices are
only deletable as drafts that have never rendered one.

### 8. The "Owed" figure ignores deposits

`getWorkStrip()` sums `invoices.total` for `status = 'sent'`. `deposit_amount` is
money already received and is not subtracted, so the dashboard overstates what is
owed by the value of any deposits taken. `InvoiceDocument` gets this right for the
client; the strip does not for Kyle.

### 9. GST defaults to `add` everywhere except the live settings row

Schema default (0004), `createInvoice` fallback, and `SettingsManager`'s
placeholder state are all `'add'`. If the `business_settings` row were ever lost
or recreated, new invoices would silently start charging 10% GST that Kyle is not
registered to collect, and would head themselves "Tax Invoice". Given
`CLAUDE.md` states no-GST as a standing rule, changing the schema default and the
code fallback to `'none'` would make the code agree with the business.

### 10. Dead code

`src/components/admin/ProjectBoard.tsx` and `ProjectCalendar.tsx` are unimported.
`src/lib/board-shared.ts` serves only them. They still speak `board_cards`, which
is itself pending deletion. Removing all four together is the tidy end of the
dashboard migration.

### 11. Stale comments that will mislead the next reader

- `uploadReportPdf` in `src/app/admin/reports/actions.ts`: "The portal has no
  renderer". It does, in `src/lib/pdf-render.ts`.
- Migration `0042`'s header says the portal does not make the PDF. Correct when
  written, superseded since. Do not edit an applied migration; note it here
  instead, which is what this line is for.
- `docs/dashboard-spec.md`'s generation table says reports appear "Day 1 of the
  month, per retained client". The code raises one for any draft report, daily.
