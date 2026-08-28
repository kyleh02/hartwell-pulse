# The dashboard, rebuilt as a work system

Design agreed with Kyle on 26 August 2026, across four rounds of questions,
and built the same day. This is the reference for why it is shaped as it is,
and the thing to read first if the chat that produced it is lost.

---

## Why the current one does not get used

**It only knows about one table.** `/admin` reads `board_cards`: title,
description, three columns, a due date, an optional client. It has not been
touched since migration 0001. Everything built since has been built alongside
it rather than into it.

**The work is in five places and four of them never reach the dashboard.**

| Where | What it holds |
|---|---|
| `board_cards` | The kanban. Manual, generic, unlinked to anything |
| `crm_tasks` | Follow-ups, LinkedIn connects, re-verifies, annual reviews |
| `crm_organisations` | The send plan: scheduled sends, drafts, approvals |
| `invoices` | Due, overdue, recurring |
| `reports` | Draft, publish, PDF, send |

**The notifications nag because they are announcements, not work.** The table
carries `read_at` and nothing else. There is no done, no snooze, no "not doing
this". `/api/cron/crm-reminders` turns every due CRM task into a notification
every day, and reading it changes nothing, so it returns tomorrow. That is the
entire mechanism behind the nagging.

So the job is not to redecorate the board. It is to decide what a unit of work
is, get all five systems speaking in that unit, and give every item a verb.

---

## The sixteen decisions

1. **One `work_items` table** is the spine. Everything becomes a row of the
   same shape that remembers where it came from.
2. **Today is one ordered list**, not a board. The question being answered is
   "what next", not "where is everything".
3. **A notification becomes an item with buttons.** It stops arriving once
   actioned, because the action is recorded rather than merely read.
4. **Four sources feed it**: CRM sends and follow-ups, invoices and money,
   reports and client deliverables, and Kyle's own admin.
5. **Rules create items; Kyle adds his own.** The list is complete without
   being maintained, which is the only reason it is worth having.
6. **What Done does depends on the item.** Harmless things act. Consequential
   things do not: see the table below.
7. **A workflow is one item with a checklist inside**, not a chain of rows.
   The list stays short and a six-step job reads as one job.
8. **Everything repeats**: monthly reports, weekly checks, quarterly and
   annual, and per-client rhythms.
9. **Ordered by time, draggable.** Overdue first, then anything with a real
   clock on it, then by date. A drag sticks.
10. **Two buttons for not-done**: Snooze, and Not doing with an optional
    reason.
11. **Overdue asks once, then stops.** It never silently repeats and never
    quietly disappears.
12. **A thin strip of live numbers** above the list. Six figures, each a link.
13. **CRM sends appear on Today; `/admin/crm/plan` stays** as the run sheet and
    keeps the auto-schedule.
14. **`board_cards` fold into work items**; the board and calendar become
    views over the same data.
15. **Interruptions: a morning brief, plus a nudge for timed sends.** Nothing
    else pushes.
16. **Hours are logged against an item.** No timer. Invoice pull comes later,
    if at all.

---

## Data model

### `work_items`

```
id             uuid pk
title          text not null
detail         text
client_id      uuid null            -- null = Kyle's own work
brand          text null            -- hartwell | ironpeak, for filtering

due_at         timestamptz null     -- null means someday, not today
has_time       boolean not null default false
                                    -- true when the clock matters (an 08:47
                                    -- send), false when only the day does.
                                    -- Ordering and the timed-send nudge both
                                    -- read this rather than guessing from
                                    -- whether the time happens to be midnight.

source_kind    text not null default 'manual'
                 check in ('manual','crm_send','crm_task','invoice',
                           'report','recurring','notification')
source_id      uuid null            -- the row it stands for, for linking
source_key     text null            -- what makes it unique, and it is a STAGE
                                    -- not a row: "invoice:<id>:overdue7" and
                                    -- ":overdue30" are different work about
                                    -- one invoice

state          text not null default 'open'
                 check in ('open','done','dropped')
done_at        timestamptz
dropped_at     timestamptz
drop_reason    text                 -- one line, so a decision is legible later
snoozed_until  timestamptz          -- open but out of Today until then

asked_at       timestamptz          -- "still doing this?" asked, once
position       integer              -- manual order within a day
hours          numeric(6,2)         -- logged after the fact
hours_note     text

created_by     text
created_at     timestamptz not null default now()
updated_at     timestamptz not null default now()
```

**The index that matters:**

```sql
create unique index work_items_source_open_idx
  on work_items (source_kind, source_key)
  where state = 'open' and source_key is not null;
```

A generator can run every hour and never make a second OPEN item for the same
stage. Same trick the recurring invoice cron already uses, and it is what stops
the dashboard becoming the notification problem in a nicer font.

Keyed on the stage rather than the row, and partial on `open` rather than
covering everything, for one reason each. The stage is what lets Not doing
suppress a single nag: drop `invoice:<id>:overdue7` and `:overdue30` is still
free to arrive three weeks later. The partial is what lets it arrive at all,
since a dropped row would otherwise block its own successor forever.

### `work_item_steps`

```
id, work_item_id, label, done_at, position
```

The checklist inside an item. "Haus of Vitality August report" is one row on
Today; opening it shows write, publish, make the PDF, test, send. Progress
reads as 3 of 6. Steps never appear on Today in their own right.

### `work_item_recurrences`

```
id, title, detail, client_id, brand
pattern        text    -- monthly | weekly | quarterly | annual
day_of_month   int     -- or day_of_week
lead_days      int     -- appear this many days before it is due
steps          jsonb   -- the checklist to stamp out each time
active         boolean
last_made_on   date    -- dedup, so a cron can run daily and make one
```

---

## What Done does, per source

This is decision 6 in full. The rule: **a tick may never fabricate a record
that has legal or financial weight.**

| Source | Done does |
|---|---|
| `manual` | Closes the item. Nothing else exists to update |
| `crm_task` linkedin_connect, reverify, annual_review | Sets `crm_tasks.done_at`. Harmless and reversible |
| `crm_send` | **Opens the composer. Never logs the touch.** The touch log is the Spam Act defence, and evidence of something that did not happen is not evidence |
| `invoice` due or overdue | **Opens the invoice. Never marks it paid.** Money moves when money moves |
| `report` | Opens the report at the step the checklist is up to |
| `notification` | Closes the item and marks the notification read |

Where the item opens a screen, ticking it on Today is refused with a line
saying where to go. That is deliberate friction on exactly the two paths where
being wrong is expensive.

---

## Generation rules

Run by an hourly cron. Each is idempotent through the unique index.

| Source | Item appears | Title |
|---|---|---|
| Invoice | 3 days before due, and again when it goes overdue | Chase INV-0042, Haús of Vitality |
| Invoice | Recurring one materialises | Check and send INV-0043 |
| Report | Day 1 of the month, per retained client | August report, Haús of Vitality |
| CRM | `scheduled_send_at` arrives and it is approved | Send Kennewell, 08:47 |
| CRM | Follow-up window opens | Follow up Rosebank, window closes Friday |
| CRM | `crm_tasks.due_on` arrives | Whatever the task says |
| Recurrence | `lead_days` before due | From the recurrence row |
| Notification | On insert, for admin-targeted ones | The notification title |

**Open question:** what counts as a retained client for the monthly report
rule. Right now nothing on `clients` says so.

---

## The Today page

```
┌─────────────────────────────────────────────────────────┐
│  $4,320 owed · $980 overdue · 4 sends this week          │  ← strip of six
│  2 reports due · 3 waiting on someone · 11 open          │    live numbers
├─────────────────────────────────────────────────────────┤
│  OVERDUE                                                 │
│  ▸ Chase INV-0039, Copamate          6 days   [✓][⏰][✕] │
│                                                          │
│  TODAY                                                   │
│  ▸ Send Kennewell                    08:47    [✓][⏰][✕] │
│  ▸ Haús of Vitality August report    3 of 6   [✓][⏰][✕] │
│  ▸ Check the ad account                       [✓][⏰][✕] │
│                                                          │
│  LATER THIS WEEK                        (collapsed)      │
└─────────────────────────────────────────────────────────┘
```

- **Three buttons on every row**: done, snooze, not doing. No menus.
- **Snooze** offers tomorrow, next week, a date.
- **Not doing** asks for one optional line and closes it for good.
- **Overdue** sits above Today with an age. After 7 days the morning brief asks
  once whether it is still happening; answering sets `asked_at` and it never
  asks again.
- **Board and calendar** are tabs on the same page, over the same rows.

---

## Notifications, after

- The `crm-reminders` cron stops inserting one notification per task. It
  creates work items instead.
- **One morning brief** at 7am: what is due, what is overdue, and the
  ask-once question if anything qualifies.
- **A nudge for timed items only**, where `has_time` is true, at the time.
- **Client-triggered notifications are untouched**: a message, asset feedback,
  a paid invoice still arrive when they happen, because those are someone
  waiting on Kyle.

---

## Build order

Each phase is useful on its own and safe to stop after.

1. **The spine.** `work_items`, `work_item_steps`, the Today page, manual
   items, board and calendar as views, migrate the existing `board_cards`.
2. **Generators.** Invoices, reports, CRM sends and tasks. The hourly cron.
   This is the phase that makes it worth opening.
3. **Recurrence.** `work_item_recurrences` and the daily stamp-out.
4. **Notifications reworked.** Morning brief, timed nudges, retire the nagging
   inserts.
5. **Hours.** Log against an item, read per client and month.

---

## The five questions, answered in the build

Kyle said build it rather than answer these, so they were decided in the code
and are listed here to be overruled.

1. **Retained clients.** Not inferred at all. A recurrence per client, set up
   once on `/admin/work/recurring`, IS the declaration. A rule reading services
   or invoice history would be wrong about exactly the accounts mid-change, and
   wrong silently.
2. **Not doing, on a generated item.** Suppresses that stage only. The source
   key carries the stage, so dropping `invoice:<id>:overdue7` leaves
   `:overdue30` free to arrive three weeks later.
3. **Invoice timing.** Four stages: 3 days before due, on the day, 7 days
   overdue, 30 days overdue. The last one says to pick up the phone.
4. **The weekly check.** A recurrence, not a rule, for the same reason as 1.
   One per client if the checks differ, one for all of them if they do not.
5. **Ironpeak sends while the tenant is blocked.** Generated, but only for
   records that are BOTH approved and scheduled. An unapproved record is not
   work yet, it is a decision Kyle has not made, so nothing appears until he
   makes it. That means the tenant block suppresses these on its own.

## What is built

All five phases, across three commits.

- **Phase 1** `work_items`, `work_item_steps`, Today, board, calendar,
  manual items, hours, and the `board_cards` migration.
- **Phases 2 to 4** the generators, `/api/cron/work` hourly, recurrences,
  `/api/cron/brief` at 7am Brisbane, and the removal of the per-task
  notification loop from `crm-reminders`.
- **Recurrence management** at `/admin/work/recurring`.

Migrations 0044 and 0045.

## Closed after a review of the build

Three gaps found by checking the build against the decisions rather than
against itself.

- **The timed nudge was missing.** Decision 15 was a morning brief PLUS a
  nudge for anything with a clock on it, and only the brief shipped. Added,
  with `nudged_at` (0046) so it fires once: without that column the hourly
  cron would announce the same 08:47 send every hour, which is the nagging
  again.
- **Ticking something made it vanish.** No way to see what was finished and no
  way back from a mis-tick. There is a Done view now, with the dropped items
  and their reasons beside it, and Put it back on every row.
- **An item could not be edited.** A typo in a title or a wrong date meant
  deleting and retyping. Title and date are editable in the expanded row, and
  the edit keeps an existing clock rather than silently moving an 08:47 send
  to midnight.

## Still open

- **`board_cards` is not dropped.** Its rows are copied into work items and the
  table is left alone until the new page has been used in anger. Dropping it is
  a later, deliberate act.
- **Hours do not reach an invoice.** Logged and readable per item; pulling
  unbilled hours onto an invoice was decided against for now.
- **The hourly cron needs setting up on cron-job.org**, hitting
  `/api/cron/work` with the CRON_SECRET as a bearer token. Vercel Hobby caps
  its own crons at daily, which is why the brief is in `vercel.json` and this
  one is not.
