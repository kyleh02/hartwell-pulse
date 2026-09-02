# Hartwell Pulse — operations runbook

How this thing is built, deployed, scheduled, configured and recovered.

Written 2 September 2026 against deployed commit `2dd379a` ("Show the error
instead of a blank invoice page", 31 August 2026). 194 TS/TSX files, roughly
31,000 lines, 46 SQL migrations.

**Who this is for.** Kyle, and every future AI session that opens this repo with
no memory of the last one. It is written to be loaded as shared operating
context. If you are a session starting cold, read [CLAUDE.md](../CLAUDE.md)
first for the rules and the reasoning, then this for the mechanics.

**Why it exists.** The developer's PC died in late August 2026 and the session
history went with it. The code survived on GitHub and in Google Drive; the
reasoning behind it did not. This document, plus CLAUDE.md, plus
`docs/dashboard-spec.md`, is the institutional memory being rebuilt so the next
failure costs an hour rather than a fortnight.

**Companion documents**

| File | What it holds |
|---|---|
| [CLAUDE.md](../CLAUDE.md) | 597 lines of rules, business logic and incident history. Authoritative on intent. |
| [SETUP.md](../SETUP.md) | Getting a new PC ready. Current and correct. |
| [DEPLOYMENT.md](../DEPLOYMENT.md) | First-time go-live from nothing. Historically useful, factually stale in places. See "Stale documents" below. |
| [README.md](../README.md) | Badly stale. Describes a Phase 1 build with no dashboard, reports or messaging. Do not trust it. |
| [docs/dashboard-spec.md](dashboard-spec.md) | The work-items design, and the decision record behind 0044 to 0046. |

---

## 1. The two copies, and why `npm install` cannot run in Google Drive

There are two working copies of this repo on Kyle's machine, and they do
different jobs.

| Copy | Path | Job |
|---|---|---|
| **Drive** (source of truth for editing) | `H:\My Drive\Website Code\hartwell-pulse` | Where code is written. Backed up continuously by Google Drive. Also mounted as `D:`. |
| **Clone** (build and deploy) | `C:\Users\kylea\pulse-verify` | Holds `node_modules`, `.git` and the remote. Where `npm run build` and `git push` happen. |

The Ironpeak working folder, which holds `portal-handoff-pipeline.md` (the input
to `scripts/gen-pipeline.py`), is `H:\My Drive\Ironpeak Consulting Build`.

### Why npm install cannot run inside Drive

Google Drive for desktop presents a virtual filesystem, not a local one. Three
things about it defeat npm:

1. **`node_modules` is tens of thousands of small files.** Drive tries to sync
   every one, which is slow enough to look like a hang and burns quota for no
   benefit.
2. **npm creates symlinks** for binaries under `node_modules/.bin`. The Drive
   filesystem does not honour them the way npm expects.
3. **Drive holds file locks** while it syncs. npm's rename-and-replace install
   strategy hits locked files and fails partway through, leaving a tree that is
   neither the old version nor the new one.

The symptom is not a clean error. It is a partial install that then produces
build failures with no obvious cause. Do not attempt to work around it; the
clone exists precisely so nobody has to.

`.gitignore` already excludes `/node_modules`, so no npm artefact should ever
reach Drive in the first place.

### Syncing Drive to the clone

`robocopy` with `/E`, never `/MIR`.

```
robocopy "H:\My Drive\Website Code\hartwell-pulse\src" "C:\Users\kylea\pulse-verify\src" /E
robocopy "H:\My Drive\Website Code\hartwell-pulse\supabase" "C:\Users\kylea\pulse-verify\supabase" /E
robocopy "H:\My Drive\Website Code\hartwell-pulse\docs" "C:\Users\kylea\pulse-verify\docs" /E
```

Plus any top-level file that changed: `CLAUDE.md`, `package.json`,
`next.config.mjs`, `vercel.json`, `public/`.

**`/MIR` would delete `node_modules` and `.git` from the clone.** `/E` copies
subdirectories including empty ones and deletes nothing. That distinction is the
whole reason the rule is written down.

### Line endings will lie to you

The two copies differ in line endings on nearly every top-level file. A naive
`diff` reports everything as changed when nothing is. Compare through `tr`:

```bash
diff <(tr -d '\r' < "H:/My Drive/Website Code/hartwell-pulse/CLAUDE.md") \
     <(tr -d '\r' < "C:/Users/kylea/pulse-verify/CLAUDE.md")
```

### Sync CLAUDE.md back and commit it

This is a rule, not a nicety. During the pipeline rebuild the Drive copy of
CLAUDE.md stayed current while the committed one sat five commits behind,
describing a dataset and a sending path that no longer existed. CLAUDE.md is the
only thing a new session reads. A stale one costs an afternoon the next time a
chat is lost, and chats do get lost. The same now applies to everything under
`docs/`.

---

## 2. Build, commit, deploy

Pushing to `main` deploys to Vercel. There is no staging environment and no
manual promote step. Treat a push as a deploy.

- Remote: `https://github.com/kyleh02/hartwell-pulse.git`
- Branch: `main`, tracking `origin/main`
- Host: Vercel Hobby, custom domain `portal.hartwelldigital.com`

### The order

1. **Edit in Drive.** `H:\My Drive\Website Code\hartwell-pulse`.
2. **Sync to the clone** with robocopy (section 1).
3. **Build in the clone.**
   ```
   npm --prefix C:\Users\kylea\pulse-verify run build
   ```
   `npm run typecheck` (`tsc --noEmit`) is the faster check when you only want
   to know whether the types hold. The build is the one that matters, because
   Next catches things `tsc` does not.
4. **Run any new migration in the Supabase SQL Editor BEFORE pushing.** See
   section 6 for why the order is not negotiable.
5. **Commit and push from the clone.** Vercel builds `main` automatically.
6. **Watch the Vercel deployment.** A build that passes locally can still fail
   on Vercel, and the classic cause is file tracing rather than compilation
   (section 9, "Chromium binary missing").

`npm run dev` in the clone will start, but it cannot reproduce what the portal
does. See section 4.

### Scripts available

| Script | What it does |
|---|---|
| `npm run dev` | Next dev server. Limited use, see section 4. |
| `npm run build` | Production build. The gate before every push. |
| `npm run start` | Serve a built app. Rarely used. |
| `npm run lint` | `next lint`. |
| `npm run typecheck` | `tsc --noEmit`. Fast pre-flight. |

`package.json` declares no `engines` field, so Vercel picks the Node version.
Local Node should be current LTS (SETUP.md).

---

## 3. Environment variables

Every variable the code reads, where it is read, and what breaks when it is
absent. Verified by grepping `process.env` across `src/` and `next.config.mjs`,
and by reading `.env.local`, `.env.local.example` and `DEPLOYMENT.md`.

`NEXT_PUBLIC_*` variables are inlined into the client bundle at build time and
are visible to anyone who opens devtools. Everything else is server-only.

| Variable | Public? | Purpose | What breaks without it |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public | Clerk browser SDK. Read by `@clerk/nextjs`, not by our code. | Auth does not initialise. Nobody signs in. Total outage. |
| `CLERK_SECRET_KEY` | **Secret** | Clerk server SDK, `clerkMiddleware` and `clerkClient()`. | Middleware cannot verify sessions. Total outage. Also breaks the Clerk user deletion in `/api/cron/purge-clients`. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Public | `/sign-in`. | Redirects land on Clerk's default hosted page instead of the branded one. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Public | `/`. Where a fresh sign-in lands. | Post sign-in redirect goes somewhere unintended. |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL` | Public | `/sign-in`. | Sign-out lands on a protected route and bounces. |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Project URL for all three Supabase clients (`src/lib/supabase/{client,server,admin}.ts`). | Every query fails. Total outage. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | The RLS-respecting client, browser and server. This is the tenancy boundary in practice. | Every client-scoped read and write fails. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | `createAdminSupabase()` in `src/lib/supabase/admin.ts`. Bypasses RLS. | Every cron, the Resend webhook, both PDF routes and all admin cross-client operations fail. |
| `RESEND_API_KEY` | **Secret** | `sendEmail()` in `src/lib/email.ts`. | No email at all. `sendEmail` logs a warning and returns `{ skipped: true }` rather than throwing, so **the portal keeps working and nothing tells you email stopped**. See risks. |
| `EMAIL_FROM` | **Secret** by convention (not a credential) | The From header. Falls back to `Hartwell Digital <noreply@hartwelldigital.com>`. | Mail sends from the fallback address, which may not be verified in Resend, so it bounces. |
| `RESEND_WEBHOOK_SECRET` | **Secret** | Svix signature verification in `/api/webhooks/resend`. | The webhook returns 503 and every email stays at status `sent` forever. Bounces become invisible. **Not present in `.env.local` or `.env.local.example`. Vercel only.** |
| `CRON_SECRET` | **Secret** | Two jobs. Bearer-token auth for every `/api/cron/*` route (`src/lib/cron-auth.ts`), and the HMAC key for print tokens (`src/lib/print-token.ts`). | Every cron returns 503 (fails closed, deliberately) and no PDF can be rendered, because the print page cannot be signed. **Vercel only.** |
| `NEXT_PUBLIC_APP_URL` | Public | Absolute links in email (`src/lib/email.ts`), and the origin the PDF renderer navigates to. | Emails carry relative links that do not resolve in an inbox. The recurring cron **silently skips PDF rendering** (`if (!origin) return;`). The two PDF routes fall back to `req.nextUrl.origin`, so they survive. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Public | Web push. Read server-side in `src/lib/push.ts` and client-side in `src/components/notifications/PushToggle.tsx`. | Push is off. `pushConfigured()` returns false so the UI can say so rather than looking broken. |
| `VAPID_PRIVATE_KEY` | **Secret** | Signs web push messages. | Same: push silently off. |
| `VAPID_SUBJECT` | **Secret** by convention | `mailto:` contact for push services. Falls back to `mailto:admin@hartwelldigital.com`. | Nothing, the fallback is correct. |
| `MS_GRAPH_TENANT_ID` | **Secret** | Microsoft Graph client-credentials token (`src/lib/graph.ts`). | `graphConfigured()` false. `/api/cron/crm-send` returns 503. No Ironpeak drafts. **Vercel only.** |
| `MS_GRAPH_CLIENT_ID` | **Secret** | Same. | Same. **Vercel only.** |
| `MS_GRAPH_CLIENT_SECRET` | **Secret** | Same. Expires; Azure app registration secrets have a set lifetime. | Same, and it will happen without warning when the secret expires. **Vercel only.** |
| `IRONPEAK_SEND_FROM` | **Secret** by convention | The mailbox drafts are created in. | Same. **Vercel only.** |
| `CLERK_WEBHOOK_SIGNING_SECRET` | **Secret** | **Read by nothing.** Present in `.env.local` and `.env.local.example`; `grep` finds no consumer in `src/`. There is no Clerk webhook route (`src/app/api/webhooks/` contains only `resend/`). | Nothing. It is a leftover from a planned Clerk webhook that was never built. |

### Which variables exist only in Vercel

`CRON_SECRET`, `RESEND_WEBHOOK_SECRET`, `MS_GRAPH_TENANT_ID`,
`MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` and `IRONPEAK_SEND_FROM` appear
in neither local `.env.local`. They are set in the Vercel project only, and
there is no other copy. **If the Vercel project is lost, those values are gone
and must be reissued** (a new random `CRON_SECRET`, a new Resend endpoint
secret, a new Azure client secret). See section 7.

### The actual state of the two local `.env.local` files

CLAUDE.md says both copies are the same 27 July skeleton with every value blank.
**That is correct for the Drive copy and wrong for the clone.**

- **Drive** (`H:\My Drive\Website Code\hartwell-pulse\.env.local`, 27 July): Clerk
  *development* publishable key filled in; `CLERK_SECRET_KEY`, all three Supabase
  values and `RESEND_API_KEY` blank. Carries a real `VAPID_PRIVATE_KEY` and
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. No `CRON_SECRET`, no `MS_GRAPH_*`, no
  `RESEND_WEBHOOK_SECRET`.
- **Clone** (`C:\Users\kylea\pulse-verify\.env.local`, 13 June, the older file):
  carries **live values** for `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (a real JWT),
  plus Clerk *development* keys (`pk_test_`, `sk_test_`). `RESEND_API_KEY` and
  `CLERK_WEBHOOK_SIGNING_SECRET` blank. No VAPID keys, no `CRON_SECRET`, no
  `MS_GRAPH_*`.

Two consequences:

1. `npm run dev` from the **clone** can reach Supabase, and because
   DEPLOYMENT.md step 5 says the production Supabase project was reused rather
   than a separate one created, **that is very likely the live database with a
   service-role key that bypasses RLS.** Treat `npm run dev` in the clone as
   pointing at production until proven otherwise. See risks.
2. Email, cron, PDF rendering and Outlook drafting cannot work locally in either
   copy. Build and typecheck are unaffected, which is what the clone is for.

`.env.local` is gitignored (`.gitignore` excludes `.env`, `.env.local` and the
per-environment variants). Move it between machines on a USB stick, never by
email (SETUP.md step 3).

---

## 4. What `npm run dev` can and cannot tell you

It can tell you that the app compiles, that a page renders, and that a component
looks right. It cannot exercise anything below.

| Not reproducible locally | Because |
|---|---|
| Any cron | `CRON_SECRET` is unset, so `cronAuthorized()` returns 503. It fails closed on purpose. |
| Any PDF render | `printTokenFor()` returns null without `CRON_SECRET`, and `renderAndAttach` refuses with a message saying exactly that. |
| Any email | `RESEND_API_KEY` blank. `sendEmail` logs and skips. |
| Ironpeak drafting | No `MS_GRAPH_*`. |
| Resend delivery events | No `RESEND_WEBHOOK_SECRET`, and no public URL for Resend to call. |
| Web push | Keys are on Drive, not in the clone. |

The build is the local gate. Everything else is verified in production or not at
all, which is a real constraint on how this codebase should be changed: prefer
changes whose failure mode is visible and reversible.

---

## 5. Cron jobs

Two schedulers. Vercel runs the daily and weekly ones from `vercel.json`;
cron-job.org runs anything that needs to fire more often than daily, because
**Vercel Hobby caps its own cron jobs at once per day**.

Every route authorises the same way, through `cronAuthorized()` in
`src/lib/cron-auth.ts`:

```
Authorization: Bearer <CRON_SECRET>
```

It **fails closed**: a missing `CRON_SECRET` returns 503 ("Cron not configured"),
never "allow". A wrong or absent header returns 401. Vercel Cron sends the header
automatically once `CRON_SECRET` is set on the project. cron-job.org jobs must be
configured with the header by hand.

The cron routes are exempt from Clerk in `src/middleware.ts` via
`"/api/cron/(.*)"`, path-anchored with a trailing slash so a sibling like
`/api/cron-foo` is not exempted with them.

### Scheduled by Vercel (`vercel.json`)

All times UTC. Brisbane is UTC+10 year round, no daylight saving.

| Route | Schedule (UTC) | Brisbane | What it does | Failure mode |
|---|---|---|---|---|
| `/api/cron/recurring` | `0 6 * * *` | 4pm daily | For each active recurring template due this month, mint an invoice number, copy the lines, substitute `{service_start}` / `{service_end}` / `{service_period}`, render the PDF, then auto-send. Dedup by unique `(recurring_source_id, recurring_period)`; a 23505 means already billed, and a draft left over from a half-finished run is recovered and sent. Skips clients that are paused or soft-deleted. | Silent under-billing. A template that does not fire produces no error anyone sees. A missed day self-heals because "due" means `anchor <= today`, not `anchor == today`. Sets `runtime = "nodejs"`, `maxDuration = 60`. |
| `/api/cron/email` | `0 7 * * *` | 5pm daily | Delivers pending `instant` notifications by email. Message notifications batch Slack-style: at most one email per away-period per recipient, and nothing more while an earlier one sits unread. Also nudges the admin about client messages and uploads left unread for 30+ minutes. | Clients stop being told things. Notifications stay in the bell, so nothing is lost, but the email half goes quiet. |
| `/api/cron/overdue` | `0 8 * * *` | 6pm daily | Two jobs. A heads-up `reminder_days_before` days before the due date, once per invoice (`pre_reminder_sent_at`). Then the overdue nudge, at most weekly per invoice (`reminder_sent_at`), plus a one-time in-portal alert to Kyle the first time an invoice tips over. Recipients resolved through `invoiceRecipients()`, the same function the send uses. | Nobody chases anything. Invoices age quietly. |
| `/api/cron/digest` | `0 8 * * 1` | Monday 6pm | Batches pending `digest` notifications into one weekly email per recipient and stamps `emailed_at`. | The weekly summary stops. Rows accumulate unstamped and go out on the next successful run. |
| `/api/cron/brief` | `0 21 * * *` | **7am daily** | The morning brief. Generates work items first so the brief describes today, then sends **one** notification to each admin naming what is due, overdue and needing a decision. Stays silent when nothing is due. | Kyle loses the one daily prompt. This is the notification that replaced nine. |
| `/api/cron/crm-reminders` | `0 22 * * *` | 8am daily | Books a `reverify` CRM task when a prospect's evidence is older than `crm_settings.reverify_after_days` (default 14), on companies still in play. Capped at 25 per run, and skips a company that already has an open reverify task. | Stale hooks stop being flagged, and `crm_touch_guard` then refuses the send at approval time instead. Fails safe. |
| `/api/cron/purge-clients` | `0 4 * * *` | 2pm daily | Hard-deletes the portal data of clients soft-deleted more than 30 days ago, and of conversations soft-deleted more than 30 days ago. **Never touches `invoices`, `invoice_line_items` or the `clients` row itself** (kept as a named invoice anchor; only `purged_at` and `status` are stamped). Every write uses `.throwOnError()` so a failure aborts that client with `purged_at` still null and it retries next run. | A build-up of unpurged data. Not urgent, and the retry-safe design means a transient failure costs nothing. |

### Scheduled externally (cron-job.org)

Neither of these is in `vercel.json`, and both need to run more often than daily.

| Route | Intended cadence | What it does | Failure mode |
|---|---|---|---|
| `/api/cron/work` | **Hourly** | `generateWorkItems()`, `materialiseRecurrences()`, `nudgeTimedItems()`. Fills the dashboard from what the portal already knows. Safe to run as often as you like: the partial unique index on `(source_kind, source_key) where state = 'open'` makes a second run produce nothing. Hourly is the intent, because an invoice falling due at 2pm should not wait until tomorrow, and an 08:47 send needs to exist by 08:00. | The dashboard goes stale between runs of `/api/cron/brief`, which generates as well. Timed nudges stop. `nudged_at` (0046) is what stops a nudge repeating every hour. |
| `/api/cron/crm-send` | **Every few minutes** (currently should be OFF, see below) | Drafts due Ironpeak outreach into Outlook via `graphCreateDraft`. Never sends. Never logs a touch. Filters on stage `queued`, `contacted` **and `bounced`**, approved, scheduled, and `draft_created_at is null`. A draft failure clears `send_approved_at` so the record stops being retried and starts being something to look at. | Scheduled drafts do not appear in Outlook. Returns 503 if Graph is not configured. |

**`/api/cron/crm-send` should not be running right now.** The Microsoft 365
tenant is blocked (`TenantAccessBlockedException` in OWA), which CLAUDE.md reads
as the escalation of the same outbound reputation flag that produced four
`550 5.7.708` rejections on 10 and 11 August 2026. Do not resume scheduled
drafting until the block is resolved **and** the sending arrangement has changed.
Cold outreach from `kyle@ironpeakconsulting.com.au` risks the mailbox that the
Ironpeak website contact form and live client correspondence depend on.
`graphSendMail` has been deleted from `src/lib/graph.ts` rather than left sitting
unused, and restoring a send path from here is a worse idea after version 4 of
the handoff, not a better one.

### Setting up a cron-job.org job

1. URL: `https://portal.hartwelldigital.com/api/cron/work`
2. Method: GET
3. Custom header: `Authorization: Bearer <CRON_SECRET>` (the same value as in
   Vercel)
4. Schedule: hourly on the hour

The response is JSON, so cron-job.org's success/failure history is readable. A
401 means the header is wrong. A 503 means `CRON_SECRET` is not set in Vercel.

---

## 6. Migrations

They live in `supabase/migrations/`, numbered `0001` to `0046`. **They are not
auto-applied.** Kyle pastes them into the Supabase SQL Editor by hand. There is
no migration runner, no `supabase db push` in the workflow, and no table
recording what has been applied.

`supabase/setup_all.sql` is `0001` + `0002` + `0003` concatenated for bootstrapping
a brand new project. It is a one-shot; re-running it produces "already exists"
errors on the policies and triggers.

### Applied state: settled

**All 46 migrations (0001 to 0046) are confirmed applied in production as of 2
September 2026.** This was established by probing the live database for the
signature object of each migration: 34 probes, 0 missing. Some probes cover more
than one migration, which is why 34 probes settle 46 files (see the probe table
below).

CLAUDE.md's older, weaker position ("0035 to 0041 verified, everything below
assumed on the strength of the features working") is **superseded**. Do not
repeat that hedge. If a future change makes the applied state uncertain again,
re-probe rather than reasoning about it.

### The order that is not negotiable

**Run the migration before you push the code that needs it.**

This is the direct lesson of the $0 invoice (section 9). Code ships in seconds;
a migration ships when Kyle opens a browser tab. If code that writes a new column
reaches production first, PostgREST rejects the **entire** write, not just the
unknown column. Whether that is loud or silent depends on whether the caller
checks the error, and on the money path a silent one billed a client $0.00.

### Idempotency rules

Every migration must be safe to run twice, because there is no record of what
has been run and the only way to be sure is to run it again.

| Object | Pattern |
|---|---|
| Table | `create table if not exists` |
| Column | `alter table ... add column if not exists` |
| Index | `create index if not exists` / `create unique index if not exists` |
| Function | `create or replace function` |
| Trigger | `drop trigger if exists ...; create trigger ...` |
| Constraint | `alter table ... drop constraint if exists ...; alter table ... add constraint ...` |
| Publication membership | `do $$ begin alter publication ... add table ...; exception when duplicate_object then null; end $$;` (this is exactly what 0016 does) |
| **Policy** | **`drop policy if exists ...` first, then `create policy`** |

**Postgres has no `CREATE POLICY IF NOT EXISTS`.** There is no `OR REPLACE`
either. A policy must be dropped before it is created, every time, or the second
run errors. The house pattern for a set of tables is a `do $$` loop:

```sql
do $$
declare t text;
begin
  foreach t in array array['work_items', 'work_item_steps'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;
```

See `0044_work_items.sql` line 170 and `0022_crm_schema.sql` line 273 for the
live version.

**The early migrations do not follow this.** `0002_rls.sql` has 33 bare
`create policy` statements and no drops; `0003_storage.sql` has 7,
`0004_invoices_notifications.sql` has 6, `0010_asset_folders.sql` has 3. Those
files are **not re-runnable**. They are already applied and that is fine, but do
not paste them in again expecting a no-op, and do not copy their style into a
new migration.

### How to run one safely

1. Write it idempotent, per the table above. Head it with a comment block saying
   what it is for, what it replaces, which migration it runs after, and the word
   "Idempotent". Every recent migration does this and it is worth keeping.
2. Sync it to the clone and run `npm run build` there. A migration cannot break
   a build, but the code that goes with it can.
3. **Open the Supabase SQL Editor and run the migration.** Read the result. A
   `do $$` block that swallows an exception will report success either way, so
   check the object exists afterwards if it matters.
4. Probe for the object you just created (below). Confirm it is there.
5. Only then commit and push the code.
6. Exercise the changed path in production once. There is no other environment
   in which to find out.

### Verifying applied state: the probe technique

Never trust a note that says a migration was applied. CLAUDE.md used to record
0001 to 0036 as applied "as of 2026-08-07", but 0036 was written after that date,
so the note cannot have been right. Probe instead.

The technique is to ask the catalog for the object each migration creates:

- **A table**: `to_regclass('public.<name>') is not null`
- **A column**: `information_schema.columns`
- **A function**: `pg_proc` joined to `pg_namespace`
- **What a function body actually says**: `pg_proc.prosrc`, for migrations that
  replace an existing function
- **A check constraint's contents**: `pg_get_constraintdef`
- **A storage bucket**: `storage.buckets`
- **Realtime publication membership**: `pg_publication_tables`

A ready-to-run shape, for the ordinary cases. Paste into the Supabase SQL Editor:

```sql
with probe(mig, kind, obj, name) as (values
  ('0001','table',   'public.clients',            null),
  ('0002','function', null,                       'is_admin'),
  ('0004','column',  'public.notifications',      'channel'),
  ('0005','column',  'public.invoices',           'recurring'),
  ('0006','function', null,                       'notifications_client_guard'),
  ('0007','column',  'public.clients',            'purged_at'),
  ('0008','column',  'public.business_settings',  'invoice_email_message'),
  ('0009','column',  'public.invoices',           'recurring_active'),
  ('0010','table',   'public.asset_folders',      null),
  ('0011','column',  'public.asset_folders',      'client_editable'),
  ('0012','table',   'public.shares',             null),
  ('0013','table',   'public.copy_documents',     null),
  ('0014','column',  'public.invoices',           'discount'),
  ('0015','column',  'public.invoice_line_items', 'title'),
  ('0017','table',   'public.conversations',      null),
  ('0018','column',  'public.conversations',      'kind'),
  ('0019','function', null,                       'notify_on_asset_upload'),
  ('0020','column',  'public.messages',           'edited_at'),
  ('0021','table',   'public.push_subscriptions', null),
  ('0022','table',   'public.crm_organisations',  null),
  ('0023','column',  'public.invoices',           'brand'),
  ('0024','table',   'public.crm_lists',          null),
  ('0025','function', null,                       'crm_metrics'),
  ('0026','function', null,                       'crm_activity_days'),
  ('0027','column',  'public.crm_organisations',  'source_status'),
  ('0028','column',  'public.business_settings',  'reminder_days_before'),
  ('0029','column',  'public.invoices',           'recurring_terms_days'),
  ('0030','column',  'public.reports',            'brand'),
  ('0031','column',  'public.invoices',           'recipient_user_ids'),
  ('0032','column',  'public.reports',            'recipient_user_ids'),
  ('0033','table',   'public.invoice_sends',      null),
  ('0034','table',   'public.email_events',       null),
  ('0035','column',  'public.crm_organisations',  'rank'),
  ('0036','column',  'public.crm_organisations',  'send_approved_at'),
  ('0039','column',  'public.crm_organisations',  'draft_created_at'),
  ('0041','table',   'public.client_previews',    null),
  ('0042','column',  'public.reports',            'pdf_path'),
  ('0043','column',  'public.invoices',           'pdf_path'),
  ('0044','table',   'public.work_items',         null),
  ('0046','column',  'public.work_items',         'nudged_at')
)
select mig, kind, coalesce(obj, '') as obj, coalesce(name, '') as name,
  case kind
    when 'table' then to_regclass(obj) is not null
    when 'column' then exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = split_part(obj, '.', 2)
        and c.column_name = name)
    when 'function' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = name)
  end as present
from probe
order by mig;
```

Six migrations create nothing a column-or-table probe can see. Run these
separately:

```sql
-- 0003: the two private storage buckets
select id, public, file_size_limit from storage.buckets
where id in ('pulse-assets', 'pulse-reports');
-- expect two rows, public = false. 0019 set file_size_limit to 52428800.

-- 0016: notifications joined to the realtime publication
select 1 from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications';

-- 0037: crm_dry_run_touch takes THREE arguments, not two
select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'crm_dry_run_touch';
-- expect 3

-- 0038 and 0040: both replace crm_touch_guard. 0040 is later, so this settles both.
select position('outcome is distinct from ''bounce''' in prosrc) > 0 as applied_0040
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'crm_touch_guard';

-- 0045: the notification type constraint gained 'work_brief'
select pg_get_constraintdef(oid) from pg_constraint
where conname = 'notifications_type_check';
```

That is the whole method. Thirty-four probes, because several migrations share a
signature or are settled by a later one that replaces the same object.

### The CRM prospect data is not a migration

The Ironpeak pipeline is `src/lib/crm-pipeline-v2.ts`, applied in-app by "Load v4
pipeline" on `/admin/crm`, not by SQL. Thirty kilobytes of string literals proved
unreliable to paste into the Supabase SQL Editor. The file is **generated** by
`scripts/gen-pipeline.py` from `portal-handoff-pipeline.md` in
`H:\My Drive\Ironpeak Consulting Build`, and must never be hand-edited: change
the markdown and regenerate.

---

## 7. External services, and what breaks without each

Six third parties. Losing any one of them degrades or stops the portal in a
different way.

| Service | Used for | What breaks if it goes away | Recovery |
|---|---|---|---|
| **Supabase** (Postgres + Storage) | Everything. All data, all files. RLS is the tenancy boundary, enforced by `is_admin()`, `current_client_id()` and `clerk_user_id()` reading the Clerk JWT. Two private buckets: `pulse-assets` (client files, client_id as the first path segment) and `pulse-reports` (report and invoice PDFs). | Total outage. There is no cache and no offline mode. | Supabase's own backups. `supabase/migrations/` plus `setup_all.sql` can rebuild the schema on a fresh project, but **not the data**. See section 8. |
| **Clerk** (production instance) | Authentication for every route except the five public matchers in `src/middleware.ts`. Also the identity that RLS reads: the session token must carry `{ "role": "authenticated" }` or Supabase refuses the request. | Nobody can sign in. Cron routes, the Resend webhook and the print pages still work, because each verifies itself. | Clerk is the source of truth for users. `client_users.clerk_user_id` is the join, so a rebuilt Clerk instance means remapping every row. |
| **Resend** | All transactional email: invoices, reports, notifications, digests, reminders. Sends as `hartwelldigital.com`. | No email leaves the portal, and **`sendEmail` returns `{ skipped: true }` rather than throwing**, so the UI reports success. Notifications still appear in the bell. | Re-verify the domain (SPF/DKIM), reissue the API key. |
| **Resend webhook** (`/api/webhooks/resend`) | Delivery status. Svix-signed, verified by hand in `src/lib/svix-verify.ts` rather than pulling in the `svix` package for one route. Status only moves **forward** through `RANK`, because events arrive out of order and a late "sent" must never overwrite a "bounced". | Delivery tracking freezes at "sent". Bounces become invisible, which matters because "sent" is deliberately rendered grey rather than green: the gap between "we sent it" and "it arrived" is the entire point of the feature. | Reconfigure the endpoint in Resend and put the new signing secret in Vercel as `RESEND_WEBHOOK_SECRET`. |
| **Vercel** (Hobby) | Hosting, the build pipeline, the daily crons, and the **only** copy of six secrets (section 3). | The portal is offline. The daily crons stop. | Redeploy from GitHub. Every Vercel-only secret must be reissued, not recovered. |
| **Microsoft Graph** | One thing: `graphCreateDraft` puts finished Ironpeak outreach into Outlook Drafts. Client credentials, not delegated, because nobody is at the keyboard at 08:47. | `/api/cron/crm-send` returns 503. Ironpeak outreach must be composed by hand. Nothing else in the portal touches Graph. **Currently blocked at the tenant level anyway.** | Azure app registration, application `Mail.Send` permission. **Application `Mail.Send` grants access to EVERY mailbox in the tenant.** Scope it with an Exchange `ApplicationAccessPolicy` or this app can send as anyone in the business. |
| **Web push (VAPID)** | Browser push notifications, via the `web-push` package and the service worker at `public/sw.js`. Subscriptions in `push_subscriptions`, read and written only with the service role. | Push notifications stop. `pushConfigured()` returns false so the UI can distinguish "nobody has subscribed" from "push is not switched on". Email and in-portal notifications are unaffected. | Generating a new VAPID key pair **invalidates every existing subscription**. Every device has to re-subscribe. Keep the existing keys. |

---

## 8. Disaster recovery

### What the September 2026 recovery actually proved

The developer's PC died. Its SSD, its local `node_modules`, its `.next` cache and
its entire Claude Code session history went with it. Nothing of the code was
lost, because:

1. **GitHub had every commit.** `main` at `2dd379a`, 139 commits, complete.
2. **Google Drive had the working tree**, including the files that are never
   committed in a form worth keeping and, critically, the Drive `.env.local`.
3. **Supabase had the database**, untouched by any of it, and every one of the
   46 migrations was confirmed still applied.

Two copies in two independent places, and the loss cost a rebuild of context
rather than a rebuild of the product. Keep both. Do not consolidate onto one.

What was **not** recovered, and what that cost: the reasoning. Why a decision was
made, what was tried first, which bug caused which rule. That is the entire
motivation for CLAUDE.md, `docs/dashboard-spec.md` and this file, and it is why
commit messages in this repo are long and argumentative rather than terse. They
are the only durable record of intent, and they survived because they are in git.

### Restore procedure

**A new PC.** Follow [SETUP.md](../SETUP.md). Install Google Drive for desktop
and set the drive letter to **H:** (the Claude Code project and its memory are
keyed to `H:\My Drive\Website Code`, so the letter must match), install Node LTS
and Git, clone to `C:\Users\<you>\pulse-verify`, `npm install` there, and copy
`.env.local` across on a USB stick. Also copy
`C:\Users\<old>\.claude\projects\H--My-Drive-Website-Code\` to bring the AI
memory and past transcripts.

**Lost Drive folder, GitHub intact.** Clone from GitHub into the Drive path.
You lose only uncommitted work and `.env.local`.

**Lost GitHub, Drive intact.** The Drive copy is not a git repo. Create a new
repo, copy the Drive tree in, and push. The commit history is gone, which means
the reasoning is gone. This is the worst realistic case and the reason CLAUDE.md
exists as a file rather than only as commit messages.

**Lost Vercel project.** Reimport from GitHub. Re-add every environment variable
from section 3, reissuing the six that exist nowhere else. Re-add the custom
domain and its DNS. Redeploy. Then re-point the cron-job.org jobs if the URL
changed.

**Lost Supabase project.** The worst case, and the schema is the easy half. Run
`supabase/setup_all.sql`, then migrations `0004` through `0046` in order, then
probe (section 6). The **data** comes from Supabase's own backups; there is no
export in this repo. Storage objects in `pulse-assets` and `pulse-reports` are
not covered by a Postgres backup and would need Supabase's storage backup or
they are gone.

### Standing gaps in the recovery position

- There is no scripted database export. Nothing in this repo dumps the data.
- The six Vercel-only secrets have no second copy anywhere.
- Storage bucket contents (client uploads, generated PDFs) have no independent
  backup.

---

## 9. Troubleshooting, from real incidents

Each of these actually happened. The fix is in the code; what follows is how to
recognise the symptom again and what the underlying rule is.

### An invoice went out for $0.00 on the wrong terms

**Symptom.** A client received a real, numbered, sent invoice for $0.00 with the
global 14-day payment terms instead of the 7 that were entered.

**Cause.** `saveInvoice` never checked the error on its own update. Migration
0029 added `recurring_terms_days` to that write, the column did not yet exist in
production, and PostgREST rejected the **entire** update. The error went
nowhere. The invoice kept its untouched defaults, and the send that followed read
those defaults back out of the database. Commit `c5d39e5`, 7 August 2026.

**Fix.** Both writes in `saveInvoice` are checked and throw. Save, test and send
surface the failure in the page rather than swallowing it. A $0.00 total now asks
whether that is really intended, because it almost always means a save did not
land. "Test to me" was added in the same commit: it sends the identical email to
the admin's own address, **reading the saved row** rather than form state, so a
proof shows what is stored rather than what is on screen. It records nothing.

**The rules that came out of it.**

- **Always check the error on a write.** An unchecked write on the money path is
  a fault waiting for an excuse.
- **Adding a column to an existing write is exactly the moment this bites**,
  because code ships before the migration is run. Run the migration first
  (section 6).
- If an invoice looks wrong, check what is in the database, not what is on the
  screen. That distinction is what would have caught this.

### Pressing Send on an invoice hung, then showed a blank screen

**Symptom.** Send did nothing visible, then the page went blank. Nothing was
emailed and nothing was recorded.

**Cause.** The invoice send was rendering the PDF inline, and the send is reached
from a **server action**, which inherits the page's ten seconds on Vercel Hobby.
A cold Chromium start does not finish in ten seconds. The action timed out.
Commit `eeb951e`, 29 August 2026.

The report path never had this problem, because rendering was deliberately kept
off the send from the start. The same reasoning was then written *out* on the
invoice side with a comment arguing about failure semantics, which was the wrong
question: it never asked where the code runs.

**Fix and the standing rule.** **Nothing renders inside a server action. Ever.**
Rendering happens only where sixty seconds can be asked for, which means route
handlers with `export const runtime = "nodejs"` and `export const maxDuration =
60`:

- `src/app/api/invoices/[invoiceId]/pdf/route.ts`
- `src/app/api/reports/[reportId]/pdf/route.ts`
- `src/app/api/cron/recurring/route.ts`

The editor calls the route **before** calling the send action. The send simply
carries whatever PDF already exists.

**And the asymmetry is deliberate.** An invoice send **never stops** for a
missing or unreadable PDF; it logs a warning and goes without the attachment,
because the recurring cron sends invoices with nobody watching and an invoice
that does not arrive is worse than one carrying a link. A **report** send does
stop and says why, because a person is standing there to read the message. See
`src/lib/invoices-send.ts` and `src/lib/reports-send.ts`.

### Every printed page had a black border

**Symptom.** Generated PDFs and hand-printed pages came out as a light document
inside a black frame, exactly the width of the `@page` margin.

**Cause.** `html { color-scheme: dark }` sat in the base layer of
`src/app/globals.css` and was never overridden. `color-scheme` is what the
browser paints the page **canvas** from, and on a printed sheet the canvas is the
margin: the area outside the `html` box, which no `background` property can
reach. Four attempts went at backgrounds first, because a black border looks like
a background. Commit `88a8040`, 24 August 2026.

**Fix.** `color-scheme: light` in the `@media print` block
(`src/app/globals.css` around line 371), and in `ForcePrintLight`
(`src/components/reports/ForcePrintLight.tsx`) for the two pages that exist to
become a PDF. Light mode got it too, and that was a real fix rather than
tidiness: the portal's light theme had been telling the browser it was dark all
along, so scrollbars and form controls rendered dark on a light page.

**Two related traps from the same week.**

- **There are two print surfaces, not one.** `/print/report/[reportId]` is what
  Chromium photographs; `/admin/reports/[id]/preview` is what Kyle prints by
  hand. Three consecutive fixes went at the first and changed nothing, because
  the dark PDF was being produced by the second. Both now state the light palette
  from one shared component. Commit `4171dbf`.
- **Force it, do not ask nicely.** Seeding `localStorage` before navigation
  depends on the head script behaving as it does today, and an `@media print`
  rule has to beat a Tailwind utility on `<body>`. Both are fair assumptions and
  neither is worth depending on for a page whose entire job is to be
  photographed. The print page sets the light palette itself: same values, no
  media query, no layer, last in document order. Commit `d0fa0d4`. The two
  earlier measures stay, because each is still right for the case it was aimed
  at.

### The Chromium binary was missing in production

**Symptom.** The build was green, the route started, and then it failed on
`node_modules/@sparticuz/chromium/bin` not existing.

**Cause.** `serverExternalPackages` was only half of the problem. It stops the
package being bundled, which is necessary, but it does not make Next copy the
binary into the deployed function. Nothing *imports* that binary, it is read off
disk at runtime, so the file tracer had no reason to include it and did not.
Commit `44a0184`, 24 August 2026.

**Fix.** `outputFileTracingIncludes` in `next.config.mjs` names the package
explicitly, scoped to the routes that need it. Applied across `/api` it would add
roughly 67 MB to every function in the deployment.

**Note the gap.** The current config lists only
`"/api/reports/[reportId]/pdf"` and `"/api/reports/**"`. It does **not** list
`/api/invoices/[invoiceId]/pdf` or `/api/cron/recurring`, both of which also
launch Chromium. See "Risks and gaps".

### A blank invoice editor with no message

**Symptom.** Opening an invoice in the admin editor produced a blank screen. No
error, no clue, nothing to report.

**Cause.** There was no error boundary on the route, so any render failure
produced silence. Commit `2dd379a`, 31 August 2026, the currently deployed head.

**Fix.** `src/app/admin/invoices/[invoiceId]/error.tsx` shows the actual error
text and digest. Deliberately the raw message rather than a friendly apology:
this page is admin-only, Kyle is the only person who will ever see it, and the
message is the difference between "it broke" and knowing why. It also states
plainly that the invoice itself is untouched and how to get it out another way.

**This is a safety net, not a fix.** If the blank was the send timing out on
Chromium, that cause is already gone. If it was the page failing to draw, this
turns silence into something actionable. On the page where money is raised, a
blank screen is the worst failure available, because the only sensible response
to one is to try again and then give up.

### Quick diagnosis table

| Symptom | Look at |
|---|---|
| A cron returns 503 | `CRON_SECRET` is not set in Vercel. Fails closed by design. |
| A cron returns 401 | The `Authorization: Bearer` header is wrong or missing. Check the cron-job.org job. |
| `/api/cron/crm-send` returns 503 with "Outlook is not configured" | One of the four `MS_GRAPH_*` / `IRONPEAK_SEND_FROM` variables is missing, or the Azure client secret has expired. |
| PDF render fails with "CRON_SECRET is not set, so the print page cannot be signed" | Exactly that. It signs the print token as well as authorising crons. |
| PDF render returns "The print page returned 404" | The document is not saved yet, or the id is wrong. |
| PDF render times out | Chromium cold start. The route allows 60s; `page.goto` allows 45s with `networkidle0`, which waits for the signed Storage URLs the letterhead needs. |
| Emails silently stop | `RESEND_API_KEY` missing. `sendEmail` logs a warning and returns `{ skipped: true }`. Check the Vercel function logs for `[email] RESEND_API_KEY not set`. |
| Every email stuck at "sent", no bounces ever | The Resend webhook. Check `RESEND_WEBHOOK_SECRET` and the endpoint config in Resend. |
| An invoice arrives with no attachment | `invoice.pdf_path` is null or the download failed. The send does not stop for this, by design. Check the function log for `PDF unreadable`. |
| Recurring invoices arrive with no attachment | `NEXT_PUBLIC_APP_URL` is unset, so `tryRenderPdf` returns immediately without a word. |
| A report send refuses with "The attached PDF could not be read" | Correct behaviour. Re-render or remove the attachment, then send. |
| An outreach draft never appears in Outlook | Check `send_approved_at` (nothing drafts without it), `scheduled_send_at`, stage in (`queued`, `contacted`, `bounced`), and `draft_created_at` being null. Then check `send_error` on the row: a failed draft clears the approval and records why. |
| The dashboard is stale | The hourly `/api/cron/work` job on cron-job.org. It is not in `vercel.json`. |

---

## Open questions

- **Does Vercel Hobby actually run all seven crons in `vercel.json`?** Hobby caps
  cron *frequency* at once per day, which every entry respects. Whether the plan
  also caps the *number* of cron jobs per project, and whether seven exceeds it,
  cannot be determined from this repo. Check the Vercel dashboard's cron log and
  confirm each of the seven has recent successful invocations. If some are being
  silently dropped, move them to cron-job.org alongside `/api/cron/work`.
- **Is `/api/cron/work` currently configured on cron-job.org?** `docs/dashboard-spec.md`
  lists it under "Still open", which suggests it may never have been set up. If
  it is not running, work items are only generated once a day by
  `/api/cron/brief`, and the timed nudge never fires. This is checkable in
  minutes and worth checking.
- **Is `/api/cron/crm-send` still enabled on cron-job.org?** It should be
  disabled while the tenant block stands. Unverifiable from the repo.
- **Is the Supabase project in the clone's `.env.local` the production one?**
  DEPLOYMENT.md step 5 says the existing project was reused for production, which
  implies yes, but nothing in the repo proves the project ref in that file is the
  live one. Verify before running anything locally that writes.
- **When does the Azure `MS_GRAPH_CLIENT_SECRET` expire?** App registration
  secrets have a fixed lifetime and expire without warning. Not recorded
  anywhere. Moot while the tenant is blocked; not moot afterwards.
- **Is there a Supabase backup policy, and does it cover Storage?** Postgres
  point-in-time recovery and Storage object backup are separate things on
  Supabase, and neither is documented here.
- **`board_cards` still exists** after 0044 migrated its rows into `work_items`.
  Dropping it is described as a later deliberate act once the new page has been
  used in anger. Nothing records whether that point has been reached.

## Risks and gaps

**Chromium file tracing does not cover two of the three routes that launch it.**
`next.config.mjs` scopes `outputFileTracingIncludes` to
`"/api/reports/[reportId]/pdf"` and `"/api/reports/**"`. Both
`src/app/api/invoices/[invoiceId]/pdf/route.ts` and
`src/app/api/cron/recurring/route.ts` call `renderAndAttach`, which dynamically
imports `@sparticuz/chromium`. Whether they work today depends on whether Vercel
happens to hoist the binary into a shared layer, which is not something to rely
on. This is the exact failure mode of commit `44a0184`, and on the recurring cron
it would be **invisible**: `tryRenderPdf` catches everything and logs a warning,
so a broken render just means invoices quietly go out without their PDF. Add
`"/api/invoices/**"` and `"/api/cron/recurring"` to the config, or confirm by
rendering an invoice PDF in production and watching it succeed.

**A live service-role key sits in plaintext on the build clone.**
`C:\Users\kylea\pulse-verify\.env.local` carries a real
`SUPABASE_SERVICE_ROLE_KEY` JWT, which bypasses RLS entirely, plus the Supabase
URL and anon key. CLAUDE.md states both local env files are blank skeletons,
which is wrong and would lead a future session to assume local work cannot touch
production data. It can. Correct CLAUDE.md, and consider whether that key should
be there at all given that nothing in the local workflow needs it.

**Email failure is silent by design, with no alarm.** `sendEmail` returns
`{ skipped: true }` when `RESEND_API_KEY` is missing, and `recordEmail` swallows
its own failures after logging. Both choices are right in isolation (telemetry
that can stop an invoice reaching a client is worse than no telemetry), but the
combination means a Resend outage or a revoked key produces no visible signal
anywhere. The only detection is reading Vercel function logs.

**Reminders carry no PDF, and this is a real gap.** Email attachments are wired
in exactly **two** places: `src/lib/invoices-send.ts` and
`src/lib/reports-send.ts`. The invoice send carries the PDF. The **due-soon
heads-up and the overdue nudge in `src/app/api/cron/overdue/route.ts` attach
nothing**; they send HTML plus a portal link. The stated reason the send attaches
a PDF is that a client handed only a link has a sign-in between them and the
thing they were promised. That reasoning applies with equal force to the chase
email, and arguably more, since a client who has not paid may be a client who
cannot find the invoice. Deliberate or not, it is currently inconsistent.

**Six secrets exist in exactly one place.** `CRON_SECRET`,
`RESEND_WEBHOOK_SECRET` and the four Graph/Ironpeak variables live only in the
Vercel project. Losing the project means reissuing all six and reconfiguring
Resend and Azure. `CRON_SECRET` is the worst of them, because it is also the HMAC
key for print tokens: changing it invalidates nothing persistent (tokens live
five minutes) but it must be updated in every cron-job.org job at the same
moment, or those jobs start returning 401 silently.

**There is no environment between the laptop and production.** No staging, no
preview database, no way to run a cron or a render or an email locally. Every
change to those paths is verified in production or not at all. This is a
consequence of Hobby plus a single Supabase project, and it is the strongest
argument for the codebase's habit of failing loudly and reversibly.

**Applied migration state is still not tracked.** It was probed and settled on 2
September 2026, and the probe technique is written down, but nothing records the
answer inside the database. The next migration re-opens the question. A tiny
`schema_migrations` table stamped by hand at the end of each migration file would
close it permanently and is a change worth making.

**Early migrations are not re-runnable.** `0002`, `0003`, `0004` and `0010`
create policies without dropping them first, because they predate the rule.
Pasting any of them in again errors partway through, which on `0002` means 33
policies half-applied. Do not treat "all migrations are idempotent" as true of
the whole set; it is true from roughly `0011` onward.

**`DEPLOYMENT.md` and `README.md` are stale and will mislead.** DEPLOYMENT.md
step 5 says "make sure every migration has been run: `0001`-`0006`" and step 9
lists four crons with wrong schedules (`/api/cron/email` "every 2 min",
`/api/cron/recurring` "1st of month 7am"). The real schedules are in section 5
above and in `vercel.json`. README.md describes a build with no dashboard, no
reports, no messaging and no notifications, none of which is true. Both are
useful as history and dangerous as instruction. Either update them or head each
with a line saying what it no longer describes.

**`CLERK_WEBHOOK_SIGNING_SECRET` is in both env files and read by nothing.**
There is no Clerk webhook route. Harmless, but it invites a future session to
assume a Clerk webhook exists and to look for a bug in it.

**The Ironpeak sending path is stopped and the reason must not be forgotten.**
The Microsoft 365 tenant is blocked at Microsoft's end. `graphSendMail` has been
deleted rather than commented out, deliberately. If a future session sees
`graphCreateDraft` and thinks a send function is the obvious missing piece, that
would undo a decision made after four confirmed delivery failures and a
tenant-level block. Read CLAUDE.md's "Ironpeak outreach" section before touching
anything in `src/lib/graph.ts` or `src/lib/crm-send.ts`.
