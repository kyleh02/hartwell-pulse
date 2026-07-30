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
- 0001–0021 are applied in production as of 2026-07-27.

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

## Ironpeak CRM (admin only)
- Ironpeak Consulting is a **registered business name against Hartwell Digital's
  ABN 44 286 503 049**, trading in defence only. Internal surfaces may say
  Hartwell is the parent; **client-facing output must not** — no "a business of
  Hartwell Digital", no dual logos. The bare ABN line is the only permitted
  expression of the parent.
- `crm_*` tables are admin-only (`is_admin()`), so clients never see a prospect.
  Prospect list is 59 DIDG grant recipients seeded in 0023.
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
- Benchmarks: 3 sends a week, 2 to 3 substantive replies per 15, and **zero
  opt-outs** — that last one is the health metric, shown first.

## Platform constraints
- Vercel Hobby: crons max once daily (sub-daily jobs run via cron-job.org
  hitting `/api/cron/*` with CRON_SECRET). No WebSocket hosting.
- Never put `next/image` in front of Supabase signed URLs (rotating tokens
  defeat its cache and burn the Hobby optimiser quota). Thumbnails are
  self-generated WebP at upload, served as plain lazy `<img>`.
- Supabase image transforms are Pro-only — don't rely on them.

## House copy rules
Australian English. No em dashes. No AI clichés. Friendly, plain, direct.
