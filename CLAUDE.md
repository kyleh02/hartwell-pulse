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
- **Build + deploy copy:** a local git clone (e.g. `C:\Users\<you>\pulse-verify`).
  Sync Drive → clone with robocopy (`/E`, never `/MIR`), then
  `npm --prefix <clone> run build`, then commit + push from the clone.
- `.env.local` holds all secrets (Supabase service role, Clerk, Resend,
  CRON_SECRET). It is gitignored — copy it between machines manually.

## Database migrations
- Live in `supabase/migrations/`, numbered. They are NOT auto-applied: Kyle
  pastes them into the Supabase SQL Editor manually.
- Write them idempotent: `add column if not exists`, `drop policy if exists`
  before `create policy` (Postgres has no CREATE POLICY IF NOT EXISTS),
  `drop trigger if exists`, guarded `do $$` blocks.
- 0001–0027 are applied in production as of 2026-08-01. The CRM prospect data
  is NOT a migration: it imports in-app from Pipeline, because 30 KB of string
  literals proved unreliable to paste into the Supabase SQL editor.

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
- Kyle is NOT GST-registered → invoices default "No GST". AUD, en-AU formats.
- Sent invoices are never hard-deleted — VOID only (keeps number + audit trail;
  ATO 5-year record keeping). Drafts may be deleted. Paid is fully locked.
- Invoice numbering via `next_invoice_number()` sequence. Discounts are
  negative line items, netted into a Discount row in the totals.
- Recurring billing: template invoices with `recurring_active`; the daily cron
  materialises + auto-sends one invoice per template per month (unique index
  dedup), evaluated in Australia/Brisbane time.

## CRM (admin only, two brands)
- One CRM, two pipelines, toggled by `?brand=` on /admin/crm: **ironpeak** and
  **hartwell**. Prospects, lists and metrics are all brand-scoped so a reply
  rate from one client base never averages into the other.
- **The rule sets differ, deliberately.** Ironpeak's gates (two-email cap,
  technical-domain finding plus positive finding before a first email, nine
  pre-send checks) are defence *playbook strategy* and fire only for
  `brand = 'ironpeak'`. Applying them to Hartwell Digital's general client base
  would make the CRM unusable for it.
- **Universal for every brand, because it is law not strategy:** the Spam Act
  2003 covers every commercial electronic message sent in Australia, so the
  opt-out block and the full consent trail are required before any outbound
  email is logged, whichever brand it is.

## Ironpeak specifics
- Ironpeak Consulting is a **registered business name against Hartwell Digital's
  ABN 44 286 503 049**, trading in defence only. Internal surfaces may say
  Hartwell is the parent; **client-facing output must not** — no "a business of
  Hartwell Digital", no dual logos. The bare ABN line is the only permitted
  expression of the parent.
- `crm_*` tables are admin-only (`is_admin()`), so clients never see a prospect.
  The researched list lives in `src/lib/crm-pipeline-master.ts` and applies via
  **Sync master list** on Pipeline. Of the 59 companies, 34 are ruled out
  (stage `lost`, reason kept), 25 are live, 3 contacted.
- **Sync updates, it never wipes.** The names match one for one, so clearing
  first would destroy the research notes and the logged sends, and that touch
  log is the Spam Act defence. A company already further along than the sheet
  is left where it is.
- The master CSV carries **no `email_source_url`**, so sync leaves it blank
  rather than guessing `{domain}/contact`. Sends stay blocked until Kyle fills
  each one: a fabricated source URL would fake the one thing that must be
  checkable.
- Prospects belong to a **source list** (`crm_lists`). Provenance is what makes
  a first email specific, and it stops reply rates from different sources being
  averaged into one meaningless number. New batches get their own list.
- `email_as_published` and `direct_email` are **different fields on purpose**.
  The published one is the consent evidence and must never be overwritten by a
  personal address given later.
- The compliance trail is the point, not a nicety. Cold outreach relies on
  **inferred consent under the Spam Act 2003**, which only attaches to an
  address the business itself conspicuously published. `email_as_published` is
  stored **verbatim** (never trimmed or lowercased) with its source URL and
  verified date, because those three are the legal defence.
- Rules enforced by database triggers, not just UI: one contact per
  organisation; hard block on touching an opted-out contact; two emails then the
  sequence closes (lifts once they reply); a first email needs a
  **technical-domain finding and a positive finding** on the research note; all
  nine pre-send checks ticked, stored per touch.
- Kyle sends from Outlook. The portal **logs** sends, it does not send them.
  Logging is what advances the stage, counts towards the daily goal, and books
  the LinkedIn request and day 8 to 10 follow-up.
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
