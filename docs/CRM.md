# The CRM and outreach subsystem

Reference for the largest and least self-evident part of Hartwell Pulse.
Written 2 September 2026 against commit `2dd379a`, from the code, not from
memory. Intended to be loaded as operating context by a future session as well
as read by Kyle.

Every claim below was checked against a file. Where something could not be
checked it says so.

---

## 0. Read this before touching anything

**Outreach sending is STOPPED. Do not restart it.**

The Microsoft 365 tenant that Ironpeak sends from is blocked. OWA returns
`TenantAccessBlockedException`, which is a tenant-level block applied by
Microsoft, not a password fault, not a licence fault, and not DNS. The four
`550 5.7.708` rejections on 10 and 11 August 2026 are read as the earlier stage
of the same thing: an outbound reputation flag that throttled programmatic
submission first and escalated to the whole tenant a week later.

`CLAUDE.md` states the rule and it is authoritative:

> **Do not resume scheduled sending until the block is resolved AND the sending
> arrangement has changed.**

Both conditions, not either. Cold outreach from `kyle@ironpeakconsulting.com.au`
puts at risk the mailbox that the Ironpeak website contact form and live client
correspondence depend on.

What this means mechanically: `/api/cron/crm-send` still exists and still works,
but nothing it drafts can be sent, because the send is Kyle pressing send in
Outlook and Outlook cannot reach the tenant. `graphSendMail` has been deleted
from `src/lib/graph.ts` rather than left sitting unused, deliberately, and
restoring it is a worse idea after version 4 of the handoff than it was before.

**Seven sends from 12 and 13 August have an unknown outcome and the database can
no longer answer.** Section 13 has the detail. Do not assume they went. Do not
assume they did not.

---

## 1. What this subsystem is, and which brand it serves

One CRM, two pipelines, switched by `?brand=` on `/admin/crm`. The two brands
are `ironpeak` and `hartwell`, and the split is real: prospects, lists and every
metric are brand-scoped so a reply rate from one client base never averages into
the other.

Everything is admin-only. The `crm_*` tables carry a single RLS policy,
`using (public.is_admin()) with check (public.is_admin())`, applied in a loop
over all ten tables in `supabase/migrations/0022_crm_schema.sql`. A client
signed into the portal sees nothing at all, which is also why `searchEverything()`
in the command palette can be a flat unbranched sweep: it runs on the RLS
client, so `crm_*` simply returns nothing for a client account.

### The two rule sets differ on purpose

| Rule | Applies to | Why |
| --- | --- | --- |
| Opted-out contact is an absolute block | every brand | Spam Act 2003, law |
| Full consent trail before an email may be logged | every brand | Spam Act 2003, law |
| Terminal stages end all contact | every brand | law and courtesy |
| Two emails then the sequence closes | `ironpeak` only | defence playbook strategy |
| First email needs a dated verified fault under 14 days old | `ironpeak` only | defence playbook strategy |
| All nine pre-send checks ticked | `ironpeak` only | defence playbook strategy |

The brand split lives inside `crm_touch_guard`, guarded by
`if org_brand = 'ironpeak' then`. The reasoning, recorded in
`0025_crm_brands.sql`, is that the Ironpeak gates come from a sector where one
forwarded complaint costs more than the campaign returns, and forcing them onto
Hartwell Digital's ordinary client base would make the CRM unusable for it. The
Spam Act half is not strategy and applies to both.

### Ironpeak-only in practice

The outreach machinery on top of the CRM is Ironpeak only, hardcoded, not
configured:

- The Send plan link and the Load pipeline button render only when
  `brand === 'ironpeak'` (`src/app/admin/crm/page.tsx`).
- `OutreachComposer` renders only for an Ironpeak organisation
  (`src/app/admin/crm/[orgId]/page.tsx`).
- `/admin/crm/plan` queries `.eq("brand", "ironpeak")`.
- `autoSchedule`, `replacePipeline` and `/api/cron/crm-send` all filter to
  `ironpeak`.

The Hartwell brand gets the board, source lists, contacts, the touch log, the
metrics and the universal Spam Act guard. It has no outbox, no send plan and no
generated pipeline.

### Ironpeak's brand constraint

Ironpeak Consulting is a registered business name against Hartwell Digital's
ABN 44 286 503 049, trading in defence only. Internal surfaces may say Hartwell
is the parent; **client-facing output must not**. No "a business of Hartwell
Digital", no dual logos. The bare ABN line is the only permitted expression of
the parent. `src/app/unsubscribe/[token]/page.tsx` carries a comment saying
exactly this and deliberately shows only the Ironpeak wordmark.

---

## 2. File map

| Path | What it is |
| --- | --- |
| `src/app/admin/crm/page.tsx` | The board. Brand toggle, health strip, list switcher, prospect table |
| `src/app/admin/crm/[orgId]/page.tsx` | One prospect. Composer above, detail below |
| `src/app/admin/crm/plan/page.tsx` | The run sheet. Whole schedule, then today's work |
| `src/app/admin/crm/actions.ts` | Every server action. 1162 lines, the centre of gravity |
| `src/lib/crm.ts` | Read queries. Takes the caller's client so RLS applies |
| `src/lib/crm-shared.ts` | Stage and outcome vocabulary, shared by server and client |
| `src/lib/crm-presend.ts` | The nine pre-send checks. One list, two callers |
| `src/lib/crm-send.ts` | `buildOutreachText`, `draftOutreach`, `confirmSent`, signature, opt-out |
| `src/lib/crm-pipeline-v2.ts` | GENERATED. 30 records, ~67 KB. Never hand-edit |
| `src/lib/crm-unresolved.ts` | The seven unknown sends, as written-down constants |
| `src/lib/graph.ts` | Microsoft Graph. Token, and `graphCreateDraft` only |
| `scripts/gen-pipeline.py` | Builds `crm-pipeline-v2.ts` from the handoff markdown |
| `src/components/crm/*` | 12 components, listed in section 4 |
| `src/app/api/cron/crm-send/route.ts` | Drafts approved emails into Outlook at their slot |
| `src/app/api/cron/crm-reminders/route.ts` | Books re-verify tasks. No longer notifies |
| `src/app/unsubscribe/[token]/page.tsx` | Public opt-out page, still live, no longer linked |
| `src/lib/work-generate.ts` | `fromCrmSends` and `fromCrmTasks` feed the dashboard |

The handoff markdown the generator reads lives outside the repo, at
`H:\My Drive\Ironpeak Consulting Build\portal-handoff-pipeline.md`.

---

## 3. The data model

Ten tables, all created in `0022_crm_schema.sql`, plus `crm_lists` from `0024`.
The structural rule recorded at the top of 0022 is worth keeping: **every table
and column is created first, then every function and trigger**, because plpgsql
resolves `%ROWTYPE` in a `DECLARE` block at compile time, so a trigger function
referencing a table defined later in the file fails to create.

### `crm_organisations`

The company. One `stage` column covers the whole pipeline including terminals,
deliberately: the original brief listed both a status and a stage, and two
overlapping state columns drift apart.

Columns arrived in three waves.

- **0022**: identity, sector, `tier` (A to D, research quality),
  `grant_total_aud`, `headline_purpose`, `stage`, `lost_reason`.
- **0027**: `source_status` and `next_action`. `source_status` holds Kyle's own
  qualification vocabulary (skip, watch, queued, advance-queued, contacted),
  which is a different axis from the outreach stage. `next_action` is the one
  line saying what to do or why they were ruled out; keeping a skipped company
  with its reason is what stops the same business being researched again in
  three months.
- **0035**: `rank`, `priority_tier` (1 to 3 conversion tier, distinct from
  `tier`), `channel` (DIDG or AIC), `scheduled_send_at`, `scheduled_at`,
  `followup_due`, `hook`, `hook_verified_at`, `pipeline_notes`, `hard_warning`.
- **0036**: `email_subject`, `email_body`, `send_approved_at`,
  `send_approved_checks`, `send_attempted_at`, `send_error`, `graph_message_id`.
- **0039**: `draft_created_at`, `graph_web_link`.

The stage vocabulary was widened twice:

| Migration | Stages after it |
| --- | --- |
| 0022 | researched, verified, contacted, connected, followed_up, replied, conversation, proposal, won, delivered, lost, do_not_contact |
| 0035 | adds queued, blocked, linkedin_only, declined, bounced, stopped |
| 0040 | adds email_closed |

`queued`, `blocked` and `linkedin_only` describe where a record sits before any
contact, which the original list had no way to say.

### `crm_contacts`

**One contact per organisation, ever**, enforced by a partial unique index on
`(organisation_id) where is_sole_contact_for_org`. A warm internal referral the
company itself hands over is the only exception and carries the flag false.

The compliance fields are the point of this table. Cold outreach relies on
**inferred consent under the Spam Act 2003**, which only attaches to an address
the business itself conspicuously published. So:

- `email_as_published` is stored **verbatim**. Never trimmed, never lowercased,
  never canonicalised. The exact string as published is the evidence.
  `saveContact` in `actions.ts` writes it through untouched, and `ContactActions`
  displays it untouched, both with comments saying why.
- `email_source_url` (0022) or `email_source_note` (0035). The note holds where
  the address appears in words, "footer and contact page". It is **not a URL and
  must never be turned into one**: what the Act needs is that the address was
  conspicuously published plus when that was checked, and a fabricated URL fakes
  the one thing that has to be checkable.
- `email_verified_at`, `consent_basis`, `relevance_note`. All required.
- `direct_email` (0024) is a **different field on purpose**. A personal address
  someone gives you once you are talking must never overwrite the published one,
  which is the consent evidence.
- `opt_out_at`, `opt_out_actioned_at`, `opt_out_channel`, `opt_out_verbatim`.
  The Act gives five working days to action an opt-out and the date actioned has
  to be logged, which is why `opt_out_actioned_at` is separate from `opt_out_at`.
- `opt_out_token` (0036), one unguessable uuid per contact.
- `name_verified` (0035): `own-site`, `directory` or `unverified`. An own-site
  name is safe to greet by name; a directory name has never been confirmed by
  the company and needs ten seconds on LinkedIn first, or the
  `fallback_greeting`.

### `crm_research`, "the note"

The seven questions answered from public material only, plus `lead_finding`,
`lead_finding_method`, `technical_domain_finding`, `positive_finding`,
`keep_out_of_first_email`, `blocker`, and free `signals` JSON.

`lead_finding_method` exists because naive keyword searching produced false
positives on both companies researched at the time, the worst being a match on
"disp" inside "display" in a Wix bundle. Recording the method stops a repeat.

**This table is now largely bypassed.** Migration 0038 moved the first-email
gate off `technical_domain_finding` and `positive_finding` and onto the
organisation's dated `hook`, and states plainly that `crm_research` holds no rows
for the version 3 companies. The table, the form and the gate text in
`ProspectDetail` all survive. See Risks, item R2.

### `crm_touches`

The compliance record and the thing everything else is computed from.

- `channel`: email, linkedin_note, linkedin_message, reply, meeting.
- `sequence_step`: email_1, linkedin_connect, email_2, ad_hoc, inbound.
- `direction`: out or in.
- `body_snapshot`: **what was actually sent, not the template**. If a complaint
  arrives, this is the defence.
- `outcome`: none, reply_positive, reply_neutral, reply_negative, bounce,
  opt_out.
- `presend_checks`: the nine checks captured **per send**. The old tracker stored
  them once and reused them, which meant they stopped being a real check after
  the first email.

### `crm_lists`

Source lists, from 0024. Reply rates from a grant list and a cold trade show are
not the same number and must not be averaged into one. `source_note` and
`captured_on` are first-class fields rather than notes, because where a name came
from is what makes the first email specific.

**Ironpeak runs on exactly one list and `replacePipeline` maintains it.** It
creates `ironpeak-pipeline` if missing, puts all 30 records on it, then deletes
any other empty Ironpeak list. Before this, 12 companies sat on the old
`didg-2026` grant list and 18 carried no list at all, and since `PipelineView`
auto-selects the single list it finds and filters to it, those 18 never appeared
on the board. A list nobody chose, quietly hiding rows, is worse than no list.
The per-company provenance that matters is already on the record as `channel`.

### The rest

`crm_grants` (a company can hold more than one; `purpose` is the public sentence
saying what they were funded to build, which is the most useful field for
outreach). `crm_opportunities`, `crm_engagements` (`annual_review_month` drives
the recurring review reminder; live engagements feed the capacity brake).
`crm_tasks` (follow_up, linkedin_connect, reverify, annual_review, manual).
`crm_notes`. `crm_settings`, a single-row table pinned by
`id boolean primary key default true check (id)`.

---

## 4. Components

| Component | Job |
| --- | --- |
| `PipelineView` | Holds which source list is selected, so counts describe that list |
| `ListSwitcher` | Switch, create a list, add a company by hand |
| `ProspectTable` | The board, with tier / state / todo / live / stale filters |
| `ProspectDetail` | Facts, the manual send panel, note, contact, history tabs |
| `ContactActions` | mailto, tel, LinkedIn, site, and copy the exact published address |
| `CrmHealth` | Opt-outs first, then sent, replies, substantive. Capacity and abort banners |
| `GoalRing` | Today against the goal, streak, fortnight of bars |
| `OutreachComposer` | The email, the nine checks, approve and un-approve |
| `SendPlan` | Today, did not send, follow-ups, later days, sent, not sending |
| `ScheduleTable` | The whole schedule as one table with a status column |
| `AutoSchedule` | One press to lay the queue out |
| `Reschedule` | Move one send. Approval deliberately survives |
| `ReplacePipeline` | Load the current handoff over the top |

Two design notes worth keeping. `ScheduleTable` and `SendPlan` answer different
questions: "when is everything going" and "what am I doing today". The board was
being made to serve both badly. And `ScheduleTable`'s status column exists
because scheduled and approved are different things and the difference decides
whether anything happens: **a time with no approval is a plan, not a send.**

---

## 5. Pipeline v2: generated, never hand-edited

`src/lib/crm-pipeline-v2.ts` is produced by `scripts/gen-pipeline.py` from
`portal-handoff-pipeline.md`. It carries a header saying so. **Change the
markdown and regenerate. Never edit the TypeScript.**

The reason is not tidiness. Nineteen email bodies retyped by hand is nineteen
chances to change a word Kyle chose, and he has explicitly rejected specific
phrasings. Parsing keeps them byte for byte.

### What the generator reads

- **Part E**, a fenced CSV, for the structured fields: rank, tier, company,
  channel, status, state, domain, email, contact name, name verification,
  fallback greeting, sent date, follow-up due, hook verification date, email
  status and subject.
- **Part B**, split on `### N. Company` headings, for the email bodies (the first
  fenced block after an `#### EMAIL` or `#### FOLLOW-UP` heading, verbatim), the
  hook, and the prose notes.
- **Part H**, the whole of it, for the send times.

### Part H is the only clock

Part E dropped `send_at` so the two can no longer disagree. Part E supplies
structured fields, Part H supplies the times, and where they once disagreed the
generator preferred Part H because it is the later authority.

The parser reads **the whole of Part H** and relies on a strict `HH:MM` test to
keep other tables out. It used to slice at `## 2.`, which was harmless until a
rebuild moved the schedule into section 2 and it silently returned zero rows.
Any Part H row that cannot be matched to a company is **reported, not dropped**,
because a send quietly missing from the schedule is the failure this file exists
to prevent.

### `HARD_WARNINGS` is keyed by RANK, not by company

```python
HARD_WARNINGS = { 14: "...PRP founder died...", 26: "...no LinkedIn...", 3: "...BLOCKED...", 30: "...LinkedIn only...", 1: "...EMAIL IS CLOSED..." }
```

Ranks held across version 4, so all five still land correctly. **If a future
handoff re-ranks anything, that dict has to move with it** or the PRP founder
constraint attaches to the wrong company. This is the single most dangerous line
in the generator.

### What is actually in the file, verified

30 records.

| Split | Counts |
| --- | --- |
| Stage | 13 contacted, 11 queued, 3 bounced, 1 email_closed, 1 blocked, 1 linkedin_only |
| Email status | 17 ready, 11 not-written, 2 held |
| Channel | 20 DIDG, 10 AIC |
| Priority tier | 7 tier 1, 10 tier 2, 13 tier 3 |
| State | Vic 9, NSW 9, SA 4, WA 3, Tas 2, ACT 1, Qld 1, NT 1 |
| Name verification | 19 directory, 10 own-site, 1 unverified |
| Bodies present | 19 (17 ready plus the 2 held) |
| Part H times imported | 16 |
| Hard warnings | ranks 1, 3, 14, 26, 30 |

Body word counts run 150 to 174 for sixteen of the nineteen. The outliers are
real and two of them are the documented exceptions:

- **Kennewell, 198 words, no link.** Its offer is a caption pass rather than a
  rebuild. Deliberate, must not be normalised.
- **Universal Motion Simulation** opens "Good morning Dr Meikle" because the man
  publishes a doctorate. Deliberate.
- **B.B. Engineering at 122 words** and **Tynbell at 121** are shorter than the
  stated 150 to 175 band. Tynbell is held and blocked so it cannot send.
  B.B. Engineering is ready and `contacted`, meaning its body is a follow-up,
  which plausibly explains the length. Not documented as an exception anywhere.
  See Open questions, Q1.
- **Coastal Aviation at 181 words** is held and `email_closed`, so it cannot
  send either.

Only a **ready** email is loaded into the outbox. Held and not-written records
carry their blocker in `send_error` instead, so there is nothing sitting there
that could be approved by accident.

### The offer repositioning, 7 August 2026

The pipeline changed shape because the offer did. It went from capability
statements to websites. The first 14 sends led with a capability statement and
produced zero replies in eight days; across roughly 50 researched companies at
least nine had paid an agency for a website and none had a capability statement.
**Every hook is now a specific verified fault on the company's own site.**

Version 4, 18 August 2026, rewrote 16 of the 19 bodies to the shape: fault,
second observation, scope block, link, costless close, at 150 to 175 words, with
the greeting merged into the opener. It also corrected Owen International's
subject, which called DISP an accreditation and would have gone out that way.

### Absence claims are the ones that go wrong

Kennewell was wrong twice and Micron once, all the same way: a claim about "your
site" built from one page, or from text alone. Kennewell's "empty" work page
holds 29 photographs and Micron's about 63, both loaded by JavaScript. **Crawl
every page, count images and gallery markers rather than text, and prefer
presence claims.** "I found this on your site" is provable. "There is no X" is
not. Pre-send check c5 exists because of this.

---

## 6. Loading the pipeline: `replacePipeline`

One button, `ReplacePipeline`, labelled just "Load pipeline". It deliberately
carries no date and no version number: "7 Aug" sat on it through two rebuilds of
the same document and was wrong by the end, and "v4" would have gone the same way
on the next handoff.

### Replace UPDATES, it never wipes

A company that already exists is updated **in place**, keeping its id and
therefore its touch log. Only companies absent from the new list are removed, and
a removed company **carrying a logged send is kept** and marked `lost` with the
reason "Not in the current handoff. Kept: has a logged send." A compliance record
outranks a tidy list.

`replacePipeline` also creates the companies it cannot find, so it bootstraps an
empty pipeline on its own. That is why nothing else was needed: `crm-seed-data.ts`,
`crm-pipeline-master.ts` and the four actions and two components that applied them
were deleted with version 4. Every one of them would have resurrected the
companies that were deliberately triaged out and re-attached capability-statement
hooks to records whose email now leads with a website fault. **The target-NN
research files in the Drive folder are superseded and must not be re-imported.**

### Who wins when the file and the portal disagree

```
AHEAD      = contacted, connected, followed_up, replied, conversation,
             proposal, won, delivered, declined, bounced, stopped, do_not_contact
FILE_WINS  = bounced, email_closed
portalAhead(stored, fromFile) = stored && !FILE_WINS.has(fromFile)
                                && AHEAD.has(stored) && !AHEAD.has(fromFile)
```

The first version of this asked only "is the stored stage ahead?", which was too
blunt and blanked Coastal Aviation's outbox. Coastal is `contacted` in the file
too, because its first email went on 5 August and the email the file carries is
the follow-up. The file and the portal agree there, so there is nothing to guard.

The case worth guarding is **disagreement**: the file still says `queued` while
the portal says `contacted`, which means the send happened since the file was
written and the email the file carries is the one already in their inbox. That is
the one that must not be reloaded and approved a second time.

`bounced` and `email_closed` are things only the file knows, so the file wins
outright on those. Without that, a record the portal still thinks is `contacted`
would keep that stage and have its rewritten email cleared.

### Replacing clears approval AND the draft

```js
send_approved_at: null,
draft_created_at: null,
graph_message_id: null,
graph_web_link: null,
```

Approval is cleared because an email that changed is not the email that was read.
The draft is cleared one step further on: **the cron treats a non-null
`draft_created_at` as "this one is done"**, so a record drafted under an old body
would never draft again and the rewritten email would sit approved and silently
undraftable. Version 4 rewrote 16 bodies, so this was not hypothetical.

**Any draft already sitting in Outlook holds the OLD text.** Nothing here can
reach into the mailbox to withdraw it. Delete those by hand. The confirm dialog
says so.

### Past times are not a plan

```js
const futureOnly = (iso) => iso && Date.parse(iso) > now ? iso : null;
```

Part H's week ran 12 to 17 August, and importing those times verbatim is what
made the send plan render as a list of days that had already gone. Anything in
the past comes in unscheduled and gets a real slot from `autoSchedule`, which
runs at the end of `replacePipeline` so one press produces a workable plan rather
than an empty table and a second button to find.

As of today every Part H time is in the past, so a fresh load imports **zero**
scheduled times and relies entirely on `autoSchedule`.

### Contact fields written by the load

Every contact gets `email_verified_at = 2026-08-07T00:00:00+10:00`,
`consent_basis = inferred_published`, `is_sole_contact_for_org = true`,
`email_source_note` = "published on the company's own website, checked 7 August
2026", and a `relevance_note` derived from the channel: DIDG records get
"Received a Defence Industry Development Grant", AIC records get "Named as a
subcontractor in a public Australian Industry Capability plan on defence.gov.au".

Everything in the handoff was confirmed published on the company's own site on
7 August 2026, Tynbell excepted, and Tynbell is blocked so it cannot send anyway.

Note that `email_source_url` is **not** written. See Risks, item R2.

---

## 7. The send plan and `autoSchedule`

`/admin/crm/plan` is the run sheet. Three things stack up the page: the
unresolved-drafts banner (section 13), the whole schedule as one table, then the
day-grouped work.

### The plan ticks a row off from the touch log

```js
const sentAtFor = (orgId) => {
  const landed = (touchesByOrg.get(orgId) ?? []).filter(t => t.outcome !== "bounce");
  return landed.length ? landed.reduce((a,b) => a.sent_at > b.sent_at ? a : b).sent_at : null;
};
```

It used to read `send_attempted_at`, which only `markSent` ever writes, so
anything logged through the manual flow stayed on the board as outstanding work
forever. Copamate and NH Micro went on 30 July and were still listed as to do
three weeks later.

The bounce exclusion sits in this one function on purpose, so "a bounce is not a
send" lives in one place rather than as a stage check in each component.

### `autoSchedule`: the rules, applied in one press

All of them are Kyle's:

- **Four a day, weekdays only.**
- **Never on the hour or the half hour.** Mail landing at 9:00 reads as
  machinery; 8:47 reads as a person who happened to be at their desk. The slot
  times are the ones already proven in the handoff rather than random numbers, so
  a week of them still reads as a person at their desk.
- **WA companies at 11:00 AEST or later**, so they land mid-morning Perth rather
  than before anyone has sat down.
- **A follow-up lands inside its day 8 to 10 window, never before it opens.**
  That constraint wins over the four-a-day shape, because a follow-up sent early
  is worse than a day carrying five.
- **`blocked`, `linkedin_only` and `email_closed` get no slot at all.**
- **Anything already drafted keeps its time**, enforced by
  `.is("draft_created_at", null)` in the query.

The slot table:

```js
const DAY_SLOTS = [
  [[8,47],[10,26],[11,24],[14,23]],
  [[8,52],[10,34],[11,47],[15, 7]],
  [[8,39],[9,26],[11,38],[15,22]],
  [[9,18],[11,41],[13,16],[15,41]],
];
```

Picked by `day.getDate() % 4`, so the pattern varies across a week.

### `autoSchedule` never places anything in the past

It used to pin a follow-up to its stored `followup_due`, and nine of those
windows opened in early August and closed again, so the whole plan rendered as a
list of dates that had already gone.

A **lapsed** follow-up now queues from the start day and takes its turn behind
whatever is on it. Only a follow-up still inside its window beats the four-a-day
shape. A lapsed one is still worth sending; it just has no window left to
protect.

It starts **tomorrow** unless given an explicit date, so today's part-finished
day is not reshuffled underneath whatever is already in progress.

### Which records it moves

```js
.in("stage", ["queued", "contacted", "bounced"])
.is("draft_created_at", null)
.not("email_body", "is", null)
```

**Anything filtering by stage for sending must include `queued`, `contacted` AND
`bounced`.** That filter has been too narrow three times, and each time the
symptom was silence rather than an error. The same triple appears in
`/api/cron/crm-send` and in `fromCrmSends` in `work-generate.ts`.

Against the current dataset that selects **17 records**: 11 queued, 3 contacted
with ready follow-ups, and the 3 bounced re-sends.

---

## 8. The outbox and the step model

### Three different things, and they are not interchangeable

| Field or record | Means |
| --- | --- |
| `scheduled_send_at` | When it is planned to go |
| `scheduled_at` | Kyle ticked "drafted" by hand |
| `draft_created_at` | A finished draft is sitting in Outlook |
| a logged `crm_touches` row | **The actual send** |

Only the touch advances the stage, counts towards the daily goal, and stands as
the Spam Act record. `0035_pipeline_v2_send_plan.sql` explains why two states
existed before the third arrived: collapsing them into one flag would either
claim an email went out while it sits in a drafts folder, or lose the work of
having written it.

### The send sequence as the UI presents it

`SendPlan`'s Row component renders exactly three states in order, with a comment
saying "only the last one writes a record, because only the last one is true":

1. **Draft in Outlook** (`draftNow`), shown while `draft_created_at` is null.
2. **Open draft** (`graph_web_link`) plus **I sent it**, once a draft exists.
3. `markSent` writes the touch, sets `send_attempted_at`, clears
   `send_approved_at`, sets the stage and books `followup_due` at +8 days.

`markSent`'s confirm dialog says "Only do this once the email has actually left
Outlook. This writes the compliance record and starts the day 8 to 10 follow-up
clock."

### The step chosen for a touch

This is where the code currently disagrees with itself. Four places decide
whether a send is `email_1` or `email_2`:

| Caller | Rule | Bounced record resolves to |
| --- | --- | --- |
| `/api/cron/crm-send` | `stage === "contacted" ? email_2 : email_1` | **email_1** |
| `approveForSending` | `stage === "queued" ? email_1 : email_2` | email_2 |
| `draftNow` | `stage === "queued" ? email_1 : email_2` | email_2 |
| `markSent` | `stage === "queued" ? email_1 : email_2` | email_2 |

The cron carries a comment, "A re-send of a message nobody received is still the
first email", which matches `CLAUDE.md`. The other three do not. See Risks,
item R1.

### The manual path

`ProspectDetail`'s `SendPanel` is the older flow: write and send from Outlook by
hand, then log it. `logTouch` writes the touch, moves the stage
(email_1 to contacted, linkedin_connect to connected, email_2 to followed_up),
and on a first email books the two things that otherwise get forgotten: the
LinkedIn connect at +1 day and email 2 at +9 days (`FOLLOW_UP_DAYS`, the middle
of the day 8 to 10 window).

This path is currently unusable for every Ironpeak v4 record. See Risks, item R2.

---

## 9. Approval and the nine pre-send checks

### Nothing drafts without `send_approved_at`

The nine checks are ticked **at approval, not at send**. Nobody is at the
keyboard at 8:47am, and a checklist confirmed by a machine on a human's behalf is
not a check. `0036_crm_outbox.sql` states this as the important design decision
of the whole outbox.

**Editing the body clears approval.** `saveOutreachEmail` sets
`send_approved_at: null`, because an email that changed is not the one that was
read.

**Rescheduling does NOT clear approval**, and that is deliberate. The nine checks
are about the content: whether the name is real, the address is published, the
fault is current. None of them becomes untrue because the email goes at three
instead of nine. Making a reschedule cost nine re-ticks would train the habit of
ticking them without reading, which is the one thing they cannot survive.

### The nine

They live once, in `src/lib/crm-presend.ts`, imported by both
`OutreachComposer` (the automated path) and `ProspectDetail` (the manual one).
They used to be two copies of the same array, which made the automated path the
easy way to skip a check.

| Key | Check |
| --- | --- |
| c1 | The name is a real one from their own page, or the greeting is the fallback |
| c2 | Every figure, date and quoted phrase copied verbatim from their site |
| c3 | Every "not findable" line actually searched today |
| c4 | The fault is on their own site and they can check it themselves in a minute |
| c5 | The fault was verified in a rendering browser, not by text extraction |
| c6 | The body carries no signature or opt-out of its own, both are appended |
| c7 | Address is the one published verbatim on their page, not constructed |
| c8 | Screenshot of their contact page saved and dated |
| c9 | One sentence here could not have been sent to any other company |

Three were rewritten on 10 August when version 3 landed. c4 and c5 used to ask
for "a finding specific to their technical domain" and "at least one positive
finding", which belonged to the capability-statement offer. **A check nobody can
honestly tick is worse than no check, because ticking it anyway is a habit that
spreads.** c6 used to ask whether the opt-out line was present; it is appended
automatically now and cannot be left off, so the real risk inverted to a body
pasted in with its own signature already attached, which then goes out carrying
two.

The count is enforced three times over: in the composer's disabled button, in
`approveForSending` (`ticked < 9` returns a message), and in `crm_touch_guard`
which counts `jsonb_each(new.presend_checks) where value = 'true'::jsonb`.

### Approval, step by step

`approveForSending(organisationId, checks)`:

1. Count the ticks. Fewer than nine, refuse with the count.
2. Load subject, body, `scheduled_send_at`, stage, contact id. Any missing,
   refuse with which one.
3. **Run the dry run** with the same step the sender will use, so approval cannot
   pass a test the send then fails.
4. Write `send_approved_at`, `send_approved_checks`, clear `send_error`.

The composer's confirm dialog is blunt on purpose: "It goes on its own, from your
Outlook, whether or not you are at the desk. Nothing else will ask you first."

The signature and opt-out are **shown** in a collapsed block under the body, even
though they are appended at send. Appending made them invisible in the editor and
they read as missing.

---

## 10. The dry run

`crm_dry_run_touch(p_contact_id uuid, p_checks jsonb, p_step text)`.

`crm_touch_guard` is the real gate and it fires on INSERT, which means the
natural order of events is: send the email, then discover the record was refused.
That leaves an email in a prospect's inbox with no touch row behind it, which is
precisely the compliance gap the log exists to prevent.

So the sender asks first. The function inserts inside a sub-transaction, then
raises the sentinel `__crm_dry_run_ok__` to roll it back, so the guard runs in
full against real data and nothing survives. Any **other** error is the guard's
actual refusal and is re-raised for the caller to read.

The `p_step` argument arrived in `0037_dry_run_step.sql`. The original hardcoded
`email_1`, so a scheduled follow-up would have been tested against the
opening-email gate and refused. It was **dropped and recreated** rather than
given a defaulted third argument, because an overload differing only by a default
makes every existing two-argument call ambiguous.

`crm_dry_run_touch` is asked **before** anything reaches the Drafts folder, inside
`draftOutreach`. A ready-to-send draft sitting in Drafts for a record that cannot
lawfully be emailed is a trap for a tired thumb.

---

## 11. The guard: what the database refuses

`crm_touch_guard` is a BEFORE INSERT trigger on `crm_touches`. It has been
rewritten four times (0022, 0025, 0035, 0038, 0040) and the 0040 version is live.
Rules are here rather than only in the UI because **a rule that lives only in the
UI is a rule that gets clicked past at 11pm**.

On `direction = 'out'`:

1. **Opted out** is an absolute block, every brand, every channel.
2. **Terminal stages** `declined`, `stopped`, `do_not_contact` end all contact on
   every channel. `bounced` was removed from this list by 0040.

On `channel = 'email'`, additionally:

3. `blocked` refuses with an explanation: the address is no longer conspicuously
   published, so the inferred-consent basis has lapsed. Tynbell is the live case;
   their website went down, taking the conspicuous publication with it. The error
   text tells you how to clear it.
4. `linkedin_only` refuses.
5. `email_closed` refuses **email only**, and says to reach them by LinkedIn or
   telephone.
6. **Consent evidence must be complete**: `email_as_published`, plus one of
   `email_source_url` or `email_source_note`, plus `email_verified_at`, plus
   `consent_basis <> 'none'`, plus `relevance_note`. Universal, every brand.

Then, `if org_brand = 'ironpeak'` only:

7. **Two emails and the sequence closes**, unless they have replied, at which
   point it is a conversation rather than cold outreach. **Bounced touches are
   excluded from the count** (0040).
8. **On `email_1`**: a `hook` must exist, must carry a `hook_verified_at`, and
   that date must be within 14 days. Three separate error messages so you know
   which one failed.
9. **All nine checks ticked**, on every outbound email.

There is a second trigger, `crm_touch_after` (AFTER INSERT, from 0022), which on
outcome `reply_negative`, `bounce` or `opt_out` sets the organisation to
`do_not_contact`, stamps the opt-out, and closes every outstanding task. **It was
never updated by 0040.** See Risks, item R3.

Also enforced by the schema rather than the UI: one contact per organisation
(partial unique index), and one organisation name per brand
(`crm_org_name_brand_idx` on `(brand, lower(legal_name))`).

---

## 12. Bounce is not terminal, and `email_closed`

`0040_bounce_not_terminal.sql` is the clearest statement of reasoning in the
whole subsystem and is worth reading in full. The summary:

**A bounce is not a refusal.** Four companies bounced because of a sending-side
fault at Kyle's end. Nobody at any of them saw a message, and nobody refused
anything. Treating that as a decline would retire four live prospects over a
problem they had no part in.

Two consequences, both fixed in that migration:

- `bounced` stops being terminal. Contact may continue.
- The two-email cap counted touches regardless of outcome, so each of those four
  had already spent one of its two emails on a message nobody read. Bounced
  touches are now excluded, restoring all four to two remaining.

**The touch itself stays.** It is a true record of an attempt, and deleting
evidence to fix arithmetic is the wrong trade.

**A re-send logs as `email_1`.** A message nobody received is still the first one
they will read. (The cron does this. Three other callers do not; see Risks, R1.)

**`email_closed` ends one channel, not all of them.** Their mail server refuses
this sender, so email is not viable, but LinkedIn and the phone stay open.
Coastal Aviation is the case it was built for: rank 1, hard warning on the
record, and the warning text is explicit that this is an infrastructure failure,
NOT a decline, and that Robert has never seen the message.

The bounce rule shows up in four places and they agree:

- `crm_touch_guard`, the cap: `outcome is distinct from 'bounce'`.
- `plan/page.tsx` `sentAtFor`: `t.outcome !== "bounce"`.
- `SendPlan`'s `held` list excludes `bounced` with a comment saying those go back
  in the queue as re-sends.
- Every sending filter includes `bounced`.

---

## 13. The seven sends of 12 and 13 August

`src/lib/crm-unresolved.ts` holds these as **written-down constants, not a
query**, and that is load-bearing.

### What is known

Part H scheduled 16 sends across Wednesday 12 to Monday 17 August 2026. Reading
the database on 18 August narrowed that considerably:

- **Only seven were ever approved and drafted.** The cron put each into the
  Outlook Drafts folder within about three minutes of its slot, on the 12th and
  the 13th, then stopped.
- Everything scheduled for Friday the 14th and Monday the 17th was **never
  approved**, so no draft was ever created for it. The portal's only send path is
  Kyle pressing send on a draft, so a record with no draft has nothing that could
  have been sent. **Those nine are not in doubt and are deliberately not
  flagged.** Warning about all sixteen when seven are genuinely uncertain is how a
  warning gets ignored.
- The touch log settles nothing: it held seven outbound touches in total, the
  last on 11 August, so nothing at all was logged for this window.

| Company | Scheduled (AEST) | Drafted (AEST) |
| --- | --- | --- |
| Kennewell Pty Ltd | 12 Aug 08:47 | 12 Aug 10:50 |
| Lintek Pty Limited | 12 Aug 10:26 | 12 Aug 11:00 |
| One Ocean Group Pty Ltd | 12 Aug 11:24 | 12 Aug 11:25 |
| Micron Manufacturing Pty Ltd | 12 Aug 14:23 | 12 Aug 14:25 |
| Owen International Pty Ltd | 13 Aug 08:52 | 13 Aug 08:55 |
| Decem Pty Ltd | 13 Aug 11:47 | 13 Aug 11:50 |
| Process Rubber and Plastics (PRP Manufacturing) | 13 Aug 15:07 | 13 Aug 15:10 |

Each is either still sitting in Drafts unsent, or it went and was never recorded.

### Why the database can no longer answer

The evidence was `draft_created_at`. **Replacing the pipeline clears that
column**, so a rewritten body can draft again. The moment "Load v4 pipeline" was
pressed, the database stopped being able to answer the question. These rows were
captured on 18 August 2026 from the live rows, before that happened.

This is the reason they are constants. A query would return nothing today.

### How it behaves

`unresolvedDraft(company, touches)` returns the record unless an outbound touch
dated on or after `2026-08-12T00:00:00+10:00` exists. Company names are matched
lowercased and trimmed.

**It warns, it does not block.** A record that genuinely did not send has to stay
approvable, and there is nowhere to record "confirmed not sent" without a
migration. **Logging the send is the only thing that clears it**, which is the
same record the Spam Act defence rests on. Inventing a dismiss button that wrote
nothing would be worse than leaving the flag up.

It appears in two places: a banner at the top of `/admin/crm/plan`, and in
`OutreachComposer` at the moment of approval, which is the last point a person
looks before an email goes.

**Action for Kyle when the mailbox is reachable again: check Sent Items for these
seven and log the ones that went**, so a second copy of the same cold email does
not follow the first.

---

## 14. The Outlook drafting path, and why direct sending was abandoned

### The full story

**Stage one, 10 and 11 August 2026.** Four Graph sends produced four
`550 5.7.708` rejections to four unrelated recipient domains. Every message Kyle
typed by hand in Outlook the same day arrived, including a cold prospect sitting
between two of the failures. Restricted entities was empty. SPF, DKIM and DMARC
all passed. So it was neither an account block nor an authentication fault.

The remaining difference was **the submission path**. Exchange Online scores
programmatically submitted mail separately, and anything tripping the outbound
spam filter is routed through the high-risk delivery pool, whose IPs receiving
servers reject with exactly that code. Cold, templated, plain text, sent in
sequence by an application is close to a textbook trigger.

**The fix, 0039.** The portal stopped being the thing that sends. It writes the
email, schedules it, runs the checks, and puts a finished draft in Drafts with a
deep link straight to it. Kyle presses send, then confirms in the portal. What
that costs is sending while he is asleep. What it keeps is the emails in one
place, the schedule, the nine checks, the compliance log, and a delivery path
that reaches people. Given four out of four, that was not a close call.

**Stage two, version 4 of the handoff.** The Microsoft 365 tenant itself is
blocked. OWA returns `TenantAccessBlockedException`. Version 4 reads the four
`5.7.708` codes as the earlier stage of the same thing: an outbound reputation
flag that throttled programmatic submission first and escalated a week later.

The correction that matters: **manual sending did not work because it was manual,
it worked because it was slower.**

### What that means for the code

- `graphSendMail` is **deleted**, not commented out, not left unused.
  `src/lib/graph.ts` carries a block comment in its place saying why, and saying
  that restoring it is not a thing to do until the block is resolved and the
  arrangement has changed.
- `graphCreateDraft` POSTs to `/users/{from}/messages` with
  `body: { contentType: "Text", content }` and returns `{ id, webLink }`.
- Auth is **client credentials, not delegated**. There is no user at the keyboard
  when a scheduled job fires at 8:47am, so there is nobody to refresh a token.
  The token is cached in module scope, which on serverless means for the life of
  a warm instance.
- **Application `Mail.Send` grants access to EVERY mailbox in the tenant.** Scope
  it with an Exchange ApplicationAccessPolicy or this app can send as anyone in
  the business. `graph.ts` says so in capitals.

### Why not Resend

Resend sends as `hartwelldigital.com`, the domain carrying every invoice and
client notification. Cold outreach there would risk the reputation of the mail
that pays. It would also arrive with ESP headers and a tracking pixel, which is
exactly what a hand-written 1:1 email must not look like.

A consequence worth stating for anyone tracing email plumbing: **outreach does
not touch the Resend machinery at all.** It writes no `email_events` row, the
Resend webhook never sees it, and the attachment wiring in
`src/lib/invoices-send.ts` and `src/lib/reports-send.ts` (the only two places in
the codebase that attach a file to an email) has nothing to do with it. Outreach
is plain text with no attachment, no image and no tracking pixel, by design.

### A draft is not a send

Nothing at draft time writes a touch. `draftOutreach` composes; `confirmSent`
writes the `crm_touches` row afterwards, from the same body. Logging at draft
time would fill the Spam Act record with messages that never left, which is
exactly the failure this replaced: **evidence of something that did not happen is
not evidence.**

`draft_created_at` stops the cron re-drafting the same email every few minutes.
A record that **cannot** be drafted has `send_approved_at` cleared, so it stops
being retried and starts being something to look at.

### `buildOutreachText`

```js
[body.trim(), "", SIGNATURE, "", OPT_OUT].join("\n")
```

The signature and the opt-out are appended here, **never stored in a body**. A
footer retyped 30 times is wrong on at least one of them. The signature is
verbatim from the handoff: text only, no images, **no phone number, ever**, and
no mention of Hartwell Digital.

Plain text, never HTML. A cold email that arrives as a styled document reads as
marketing however good the words are.

---

## 15. The opt-out is a reply, not a link

`OPT_OUT` is one sentence:

> "If you would rather not hear from me again, just reply and say so. I will not
> write again."

Plain, human, no link. Kyle has explicitly rejected formal unsubscribe blocks
that read as automated, and on an email meant to pass as one-to-one, one of those
is also a tell that it is not.

### Why the link was removed

This was a correction, not a preference. The link pointed at
`portal.hartwelldigital.com` and was wrong on three counts, **each sufficient on
its own**:

1. The domain did not match the sending domain, which is a strong spam signal on
   cold mail.
2. The token made it per-recipient tracking, which the settled rules forbid on
   first contact.
3. It published the tie between Ironpeak and Hartwell Digital to every prospect,
   breaching the standing brand constraint.

Careful work had gone into keeping the Hartwell wordmark off the opt-out **page**
while the Hartwell domain sat in the link above it.

### Why a reply satisfies the Spam Act

What the Act requires is a **functional, low-cost way to opt out that is
honoured**. On genuine person-to-person mail a reply is exactly that, and it is
what a real person would write. Honouring it is the operator's job, and the guard
blocks every channel the moment `opt_out_at` is set.

### The link machinery still exists

`/unsubscribe/[token]` still works on GET. It is simply not linked from an email
any more.

- Public in middleware (`"/unsubscribe/(.*)"`).
- Acts on **GET**, which is normally poor practice. Here the alternative is a
  page with a button that some recipients will not press, and an opt-out that
  only works for people who complete a second step is not a functional opt-out.
- The token is validated against a uuid regex, then handed to `crm_opt_out(uuid)`,
  a `security definer` function that is the single narrow hole through the
  admin-only RLS. It **returns nothing about the contact**.
- **A wrong token is indistinguishable from a right one already actioned.** The
  page says the same thing either way, so the endpoint cannot be used to test
  whether an address is on the list.
- `crm_opt_out` stops the **company** too, not just the person, setting stage
  `stopped` unless the company is `won` or `delivered`. One contact per company is
  the rule, so a person opting out ends the company.

### Actioning an opt-out

`logReply` with outcome `opt_out` books a `crm_tasks` row: "Action the opt-out
and record the date, within five working days", due in 3 days. `OptOutRow` in
`ProspectDetail` shows the recorded date and a "Mark actioned today" button
writing `opt_out_actioned_at`. The Act gives five working days and requires the
date actioned to be logged, which is why the two timestamps are separate.

---

## 16. Goals, streaks, reminders and celebration

### The numbers

| Setting | Value | Source |
| --- | --- | --- |
| `daily_contact_goal` | 3 | Kyle, 30 July 2026 |
| `weekly_contact_goal` | 15 | Kyle, 30 July 2026 |
| `capacity_engagement_limit` | 2 | schema default |
| `abort_warning_sends` | 15 | schema default |
| `reverify_after_days` | 14 | schema default |

The schema default for `weekly_contact_goal` is 3; Kyle set 15. **The outreach
playbook benchmarks 3 a week, so this runs five times that rate**, which means the
abort warning lands after about a week rather than five. Kyle was shown that
trade-off and chose the faster pace. `CrmHealth`'s goal editor still says so
under the fields: "The playbook benchmark is three a week, not a day. Volume is
the risk in a sector this connected."

**Benchmarks that do not change**: 2 to 3 substantive replies per 15 sent, and
**zero opt-outs**. That last one is the health metric, so it is shown first on the
strip and is the only stat with the emphasised border.

### The two blocking banners

Both render above the numbers, because a blocking condition comes before a
statistic.

- **At capacity**: `live_engagements >= capacity_engagement_limit`. "Three yeses
  in a fortnight breaks a one person business."
- **Abort**: `sends_since_substantive >= abort_warning_sends`. The playbook says
  stop and reconsider the offer rather than finishing the list on momentum.

### `crm_metrics` and `crm_activity_days`

Both are `security definer` SQL functions, both take `p_brand`, both evaluate the
day boundary in **Australia/Brisbane**, the same as the recurring billing cron, so
a day means the same thing everywhere in the app.

`sends_since_substantive` counts outbound emails sent after the last substantive
inbound touch, with `-infinity` as the fallback so a campaign with no substantive
reply yet counts everything.

### The streak

`currentStreak` walks backwards over the fortnight. **Today only breaks the
streak once it is over**: a run of four should not read as zero at 9am just
because the day has not been worked yet.

`GoalRing` fills a ring rather than a bar, because the goal is a target to reach
rather than a quantity to accumulate and should read as complete or not from
across the desk. It honours `prefers-reduced-motion`.

### Tasks and reminders

Logging email 1 books two tasks: the LinkedIn connect at +1 day and email 2 at
+9 days. The LinkedIn rule is roughly two hours after each send, under 200
characters, mention the email, no pitch.

`/api/cron/crm-reminders` **no longer notifies per task**, and that cron was the
thing driving Kyle mad. A notification could only be read, and reading one changed
nothing, so it came back the next morning and the one after that. Those tasks are
`work_items` now, on the dashboard, with Done, Snooze and Not doing buttons. The
cron still books `reverify` tasks, which is the half worth keeping.

### Celebration

`celebrate()` fires on **outcomes, never activity**: finishing the day's goal
(once, checked as `goalDone + 1 === goalTarget`), a substantive reply, an invoice
paid. **Never celebrate a send.** The playbook says volume is the risk, so
rewarding each send would train the behaviour that gets a campaign complained
about. Admin surfaces only: clients are businesses and defence buyers are
conservative.

### The dashboard connection

`src/lib/work-generate.ts` turns CRM state into `work_items`:

- `fromCrmSends`: **approved** Ironpeak sends due within 24 hours, stage in
  queued / contacted / bounced, key `crm_send:<id>:<date>`, `has_time: true`
  because 08:47 is the whole point of the schedule. Unapproved records are not
  work yet, they are a decision Kyle has not made.
- `fromCrmTasks`: every open CRM task due today or earlier, key `crm_task:<id>`.

**`completeWork` refuses to tick a `crm_send`** and says where to go instead. The
touch log is the Spam Act defence and it does not get decided by a checkbox among
twelve others. A `crm_task` does close at its source, because a LinkedIn connect
is harmless and reversible.

---

## 17. The crons

| Route | Schedule | Runner | What it does for the CRM |
| --- | --- | --- | --- |
| `/api/cron/crm-send` | every few minutes | cron-job.org | Drafts approved, due emails into Outlook |
| `/api/cron/crm-reminders` | `0 22 * * *` UTC (8am Brisbane) | Vercel | Books re-verify tasks |
| `/api/cron/work` | hourly | cron-job.org | Regenerates work items, including CRM ones |
| `/api/cron/brief` | `0 21 * * *` UTC (7am Brisbane) | Vercel | One notification a day for Kyle's own work |

`crm-send` is **not** in `vercel.json`, verified. Vercel Hobby caps its own crons
at daily and these are scheduled to the minute, so it is driven externally. The
`vercel.json` entries are `email`, `digest`, `overdue`, `recurring`,
`purge-clients`, `crm-reminders` and `brief`.

All of them go through `cronAuthorized` in `src/lib/cron-auth.ts`, which **fails
closed**: a missing `CRON_SECRET` returns 503, never "allow".

### `/api/cron/crm-send`, exactly

```
stage in (queued, contacted, bounced)
send_approved_at is not null
scheduled_send_at is not null and <= now
draft_created_at is null
order by scheduled_send_at
```

then for each: `draftOutreach`, and on success write `draft_created_at`,
`graph_message_id`, `graph_web_link`, clear `send_error`, set `next_action` to
"Draft is in Outlook. Send it, then mark it sent here." On failure, write
`send_error` **and clear `send_approved_at`**, so a record that cannot be drafted
stops being retried every five minutes and starts being something to look at.

It returns early with 503 if `graphConfigured()` is false, so a missing
`MS_GRAPH_*` variable is a visible misconfiguration rather than silence.

### Environment

`MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`,
`IRONPEAK_SEND_FROM`, `CRON_SECRET`. **All of these live in Vercel only.** The
local `.env.local` on this machine is a skeleton with every secret blank and no
`MS_GRAPH_*` or `CRON_SECRET` keys at all, so nothing local can reach Supabase or
draft into Outlook. Build and typecheck are unaffected, which is what the clone is
for.

---

## 18. Migration history

| Migration | What it added to the CRM |
| --- | --- |
| 0022 | The whole schema, RLS, `crm_touch_guard`, `crm_touch_after`, `crm_metrics` |
| 0024 | `crm_lists`, `list_id`, the `didg-2026` list, `phone`, `direct_email` |
| 0025 | Two brands, two rule sets. Guard split. `crm_metrics(p_days, p_brand)` |
| 0026 | `crm_activity_days`, Brisbane day boundaries, the streak |
| 0027 | `source_status`, `next_action` |
| 0035 | Pipeline v2 columns, six new stages, guard v3 (blocked / terminal / source note) |
| 0036 | The outbox: email on the record, approval, `opt_out_token`, `crm_dry_run_touch`, `crm_opt_out` |
| 0037 | `crm_dry_run_touch` gains `p_step`. Dropped and recreated, not overloaded |
| 0038 | First-email gate moves from research findings to the dated `hook` |
| 0039 | `draft_created_at`, `graph_web_link`. Compose into Outlook instead of sending |
| 0040 | `bounced` is not terminal, excluded from the cap. `email_closed` added |

### Applied state: all 46 are applied

**Every migration from 0001 to 0046 is confirmed applied in production**, proved
on 2 September 2026 by probing the live database for the signature table or column
of each one: 34 probes, 0 missing.

This **supersedes** the older note in `CLAUDE.md` that reads "0035 to 0041 were
confirmed applied ... Everything below 0035 is assumed applied on the strength of
the features working, which is weaker evidence." That uncertainty is resolved.
Nothing in the CRM is waiting on an unapplied migration.

The habit behind that note is still right and should be kept: **applied state is
not tracked anywhere, so check it, never assume it.** Probe
`information_schema.columns` for a column, `pg_proc.prosrc` for what a function
body actually says, and `pg_get_constraintdef` for a check constraint.

Migrations are **not auto-applied**. Kyle pastes them into the Supabase SQL
Editor by hand, so write them idempotent: `add column if not exists`,
`drop policy if exists` before `create policy` (Postgres has no
`CREATE POLICY IF NOT EXISTS`), `drop trigger if exists`, guarded `do $$` blocks.

**The CRM prospect data is deliberately not a migration.** It imports in-app from
the pipeline file, because 30 KB of string literals proved unreliable to paste
into the Supabase SQL editor.

---

## 19. If sending is ever resumed

Not a recommendation to resume. A list of what would have to be true first, so
nobody has to reconstruct it.

1. **The tenant block is lifted.** OWA no longer returns
   `TenantAccessBlockedException`.
2. **The sending arrangement has changed.** `CLAUDE.md` requires this as a
   separate condition. Cold outreach from the mailbox the website contact form
   and live client correspondence depend on is the exposure, and lifting the
   block does not change that.
3. **The seven unresolved sends are settled.** Check Sent Items, log the ones
   that went. Otherwise a second copy of the same cold email follows the first.
4. **Every hook is re-verified.** As of today the newest `hook_verified_at` in
   the dataset is 11 August 2026, so **every single record fails the 14-day
   freshness gate** and no `email_1` can be logged at all. The guard refuses it
   rather than warning about it. This is not a bug, it is the gate doing its job
   after three weeks of pause.
5. **The step inconsistency in Risks R1 is resolved**, or bounced re-sends will be
   approved against one gate and drafted against another.
6. **`autoSchedule`'s timezone behaviour is checked against production** (Risks
   R4) before any slot is trusted.
7. **Old drafts in Outlook are deleted by hand.** Anything drafted before the v4
   load holds the old text and nothing in the portal can withdraw it.

---

## Open questions

**Q1. B.B. Engineering's 122-word body.** Version 4's stated shape is 150 to 175
words with two documented exceptions, Kennewell at 198 and the Universal Motion
Simulation greeting. B.B. Engineering is ready, `contacted`, and runs 122 words.
A follow-up plausibly runs shorter than an opener, but nothing in the generator,
`CLAUDE.md` or the file header says follow-ups are exempt from the band. Either
the band applies only to first emails, or this one drifted. The handoff markdown
would settle it; it is outside the repo and was not read for this document.

**Q2. Where the `weekly_contact_goal` of 15 actually lives.** The schema default
is 3 and `CrmHealth` falls back to 3. `CLAUDE.md` records Kyle setting 15 on
30 July 2026, which would be a row in `crm_settings`. Not verified against the
live row.

**Q3. Whether `/api/cron/crm-send` is still registered at cron-job.org.** The
route exists and is documented as running every few minutes. Nothing in the repo
can confirm the external job is still enabled, and if it is, it will keep drafting
into a mailbox nobody can reach. Worth checking and disabling while sending is
stopped.

**Q4. Whether the `didg-2026` list still exists.** `replacePipeline` deletes any
other Ironpeak list that is left empty, so the 0024 list was probably removed by
the v4 load. Cosmetic either way.

**Q5. Vercel's runtime timezone.** Bears directly on Risk R4 and cannot be read
from the repo. The `.env.local` here is a skeleton and no `TZ` is set in
`next.config`, `vercel.json` or the local env.

**Q6. `crm_opportunities` and `crm_engagements` are never written by any code
path found.** `crm_engagements` is read by `crm_metrics` for `live_engagements`,
which drives the capacity brake, so a brake that nothing can arm. Either these are
maintained by hand in the Supabase table editor, or the capacity banner has never
been able to fire. Not resolvable from the code.

---

## Risks and gaps

**R1. Four callers disagree on whether a bounced re-send is `email_1` or
`email_2`.** `/api/cron/crm-send` says `email_1`, matching the rule in
`CLAUDE.md` and 0040. `approveForSending`, `draftNow` and `markSent` all say
`email_2`. Three consequences, all real:

- Approval dry-runs a bounced record against the `email_2` gate, which skips the
  hook-freshness check, and the cron then drafts it as `email_1`, which does not.
  A record can be approved and then silently fail to draft.
- `markSent` logs a bounced re-send as `email_2` and sets the stage to
  `followed_up`, ending the sequence when the recipient has read nothing.
- `markSent` only books `followup_due` when `wasFirst`, so a bounced re-send gets
  no follow-up booked.

Three of the 30 records are `bounced`, all with ready bodies, so this is live.
Fix: extract one function deciding the step from the stage and call it from all
four places.

**R2. The manual "Log as sent" panel is dead for every v4 Ironpeak record.**
`ProspectDetail` computes `blocked` from two things the v4 data cannot satisfy:

- `complianceGaps()` in `crm-shared.ts` still requires `email_source_url`. The
  guard has accepted `email_source_note` as an alternative since 0035, and
  `replacePipeline` writes only the note. The contact form has no field for the
  note either, so it cannot be filled in by hand. Every record therefore reports
  "Source URL it was published at" as a gap.
- `noteReady` still requires `technical_domain_finding` and `positive_finding` on
  `crm_research`. Migration 0038 removed that requirement from the database and
  says plainly that `crm_research` holds no rows for these companies.

The result is that the button is disabled on all 30 records with a "Blocked
until" list naming two things that are no longer the rule. The plan page's
`markSent` is unaffected and is the path in use, so this has not bitten, but the
detail page now lies about why a send is blocked. `crm-shared.ts` needs to be
brought into line with the 0035 and 0038 guards.

**R3. `crm_touch_after` still treats a bounce as terminal.** Migration 0040
rewrote the BEFORE guard and left the AFTER trigger from 0022 untouched, and no
later migration replaces it. It still does:

```sql
if new.outcome in ('reply_negative', 'bounce', 'opt_out') then
  update public.crm_organisations set stage = 'do_not_contact' ...
```

So logging a reply with outcome `bounce` moves the company to `do_not_contact`,
which the guard **does** treat as terminal on every channel, and closes every
outstanding task. That is precisely the outcome 0040 was written to prevent.
`logReply`'s own TypeScript avoids setting the stage for stopping outcomes, but
the trigger fires anyway and wins. Any future bounce logged through the UI
silently retires the prospect. This needs a migration.

Two smaller effects of the same design: a bounce logged as an inbound touch makes
`had_reply` true, which **lifts the two-email cap entirely**; and `crm_metrics`
counts every `direction = 'in'` row as a reply, so a bounce inflates the reply
count.

**R4. `autoSchedule` computes slot times in the server's timezone.** It uses
`new Date()`, `setHours(h, m, 0, 0)` and `toISOString().slice(0, 10)` for the day
key. On Vercel the Node runtime defaults to UTC, and no `TZ` is set anywhere in
the repo. If the runtime is UTC, an 08:47 slot is stored as 08:47Z, which is
**18:47 Brisbane**, and the whole carefully chosen "reads as a person at their
desk" pattern lands in the evening. `isWeekend` uses `getDay()` on the same
UTC-based date, so weekend detection can be off by a day at the boundaries.

The rest of the app is careful about this: `crm_metrics` and `crm_activity_days`
do their day arithmetic in `Australia/Brisbane` in SQL, every display formats with
`timeZone: "Australia/Brisbane"`, `isoDaysFromNow` avoids `toISOString`
deliberately, and the generator writes explicit `+10:00` offsets. `autoSchedule`
is the one place that does not.

Unverified in production, because the Vercel runtime timezone cannot be read from
here, and because the 12 August drafts were scheduled from Part H's explicit
`+10:00` times rather than by `autoSchedule`, which shipped later. **Check this
before trusting a generated slot.**

**R5. The re-verify cron probably never fires for pipeline records.**
`/api/cron/crm-reminders` selects on `.lt("last_verified_at", cutoff)`.
`replacePipeline` never writes `last_verified_at`, and `saveResearch` writes it
only for organisations still at stage `researched`. A null column never satisfies
a `<` comparison in Postgres, so a v4 record with a null `last_verified_at` is
invisible to that query. Meanwhile the field that actually gates a send,
`hook_verified_at`, is not consulted by the cron at all. The one automated nudge
to re-verify evidence is looking at the wrong column, and probably at nulls.

**R6. Six stages have no UI vocabulary.** `crm-shared.ts` `CrmStage` and
`ALL_STAGES` still list only the twelve stages from 0022. `queued`, `blocked`,
`linkedin_only`, `email_closed`, `bounced`, `declined` and `stopped` are missing.
Consequences: `stageLabel()` falls through to the raw key, so the board shows
`email_closed` rather than "Email closed"; `STAGE_TONE` has no colour for them;
and `ProspectTable`'s stage `<select>` is populated from `ALL_STAGES`, so on a
row in one of those stages it renders with no matching option, and any change
made through it moves the record into one of the twelve old stages. Nineteen of
the 30 records are in a stage the picker does not know about.

**R7. `draft_created_at`, `graph_web_link` and `graph_message_id` are missing
from the `CrmOrganisation` type** in `src/lib/types/database.ts`, despite being
live columns since 0039 and being read and written in four files. Every use goes
through a cast, so nothing type-checks against reality on the columns that carry
the draft state.

**R8. `sendImmediately` is dead.** `PipelineRecord.sendImmediately` is documented
as "Coastal Aviation only: send on receipt, overriding the day 8 to 10 window",
`replacePipeline` branches on it, and `CLAUDE.md` describes it. But the generator
reads it from `r.get("send_at")` and Part E **no longer carries a `send_at`
column** at all, so it is false on all 30 records, verified. Harmless today
(Coastal is `email_closed` and cannot email), but three separate places describe
behaviour that cannot occur. Delete it or restore the column.

**R9. `fromCrmTasks` hardcodes `brand: "ironpeak"`** for every CRM task
regardless of the organisation's actual brand, so a Hartwell task would appear on
the dashboard under the wrong brand. Latent while Hartwell has no tasks.

**R10. Dead branch in `autoSchedule`'s WA handling.** The `if (!pick)` block that
tries `waFirst.shift()` cannot be reached: the ternary above already takes from
`waFirst` whenever the slot is late and the WA queue is non-empty, so `pick` is
only falsy when both queues are exhausted for that role. Harmless, but it reads as
a safety net that is not there.

**R11. The opt-out metric misses the link path.** `crm_metrics` counts opt-outs as
`crm_touches` rows with `outcome = 'opt_out'`. The `crm_opt_out` RPC, which the
public unsubscribe page calls, sets `opt_out_at` and moves the company to
`stopped` **without writing a touch**. So an opt-out arriving through the link
would not appear in the headline health metric that is deliberately shown first.
Low risk today because the link is no longer sent, but the page is still live and
still reachable by anyone holding an old email.

**R12. Nothing warns that a hook has gone stale except at send time.** The plan
page shows a per-row "Fault last checked ... Re-verify before quoting it" line and
the guard refuses at insert. Neither surfaces as a work item or a notification,
so a pipeline sitting idle silently ages out of sendability, which is exactly
where it is now.
