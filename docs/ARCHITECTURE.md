# Hartwell Pulse — system architecture

Written 2 September 2026 against deployed commit `2dd379a`.
194 TypeScript/TSX files, roughly 31,000 lines, 46 SQL migrations.

## What this document is

This is the architecture reference for Hartwell Pulse, the client portal at
https://portal.hartwelldigital.com. It is written to be loaded by a future AI
session as shared operating context, and to be read by Kyle.

The reason it exists: the machine holding the previous session history died.
The code survived, the reasoning did not. This document plus the code should be
enough to work correctly end to end with no other context.

**Read this alongside `CLAUDE.md` at the repo root.** That file is the previous
developer's 597-line handoff. Its RULES are authoritative intent and are not
restated here in full. This document covers structure and mechanism: what the
pieces are, how they fit, and why they are shaped the way they are. Where the
two disagree on a fact, this document was checked against the code on
2 September 2026 and says so.

Sibling documents in `docs/`:

| File | Covers |
| --- | --- |
| `docs/dashboard-spec.md` | The work-items dashboard: design, reasoning, migrations 0044 to 0046 |
| `docs/ARCHITECTURE.md` | This file |

---

## 1. The stack, and why each piece is there

| Piece | Version | Why it is here |
| --- | --- | --- |
| Next.js App Router | 15.1.x | Server Components mean the tenancy-sensitive reads happen on the server under the caller's own token. Route handlers are the only place `maxDuration` can be raised, which the PDF pipeline depends on. |
| React | 19 | Comes with Next 15. Server Actions are the write path for almost everything. |
| TypeScript | 5.7, `strict: true` | The database row shapes live in `src/lib/types/database.ts` and are hand-maintained, so strictness is the only thing catching a column rename. |
| Tailwind | v4 (`@theme inline`) | Brand tokens are CSS custom properties mapped into Tailwind's theme, which is what lets `doc-light` re-point `--pulse-gold` and have every component follow without a prop. |
| Supabase Postgres | via `@supabase/supabase-js` 2.47 | **Row Level Security is the tenancy boundary.** Not application code. See section 4. |
| Supabase Storage | two private buckets | `pulse-assets` and `pulse-reports`. Private, signed URLs only. |
| Clerk | `@clerk/nextjs` 6.39, Clerk.js pinned to 5.125.13 | Auth. Native third-party integration with Supabase, so the Clerk session token *is* the Supabase JWT and no JWT template is needed. |
| Resend | 6.12 | Transactional email. Webhook-verified delivery events. |
| `puppeteer-core` + `@sparticuz/chromium` | 25.8 / 149 | Headless Chromium on serverless, for PDF rendering. |
| `web-push` | 3.6 | VAPID web push for chat messages. |
| `recharts` | 2.15 | Report and dashboard charts. Strokes read `--pulse-gold`, never a literal. |
| `@tiptap/*` | 3.27 | The copy-document editor. |
| `@dnd-kit/*` | 6.3 | Drag ordering (project board, work list). |
| `date-fns`, `clsx`, `tailwind-merge`, `lucide-react` | | Utility layer. `cn()` in `src/lib/utils/cn.ts` is the only class merger. |
| Vercel Hobby | | The constraint that shapes the most code. See below. |

### The Vercel Hobby constraints, because they explain design decisions

- **Server actions get ten seconds.** They inherit the calling page's limit,
  which cannot be raised. Route handlers can set `maxDuration = 60`. This is the
  single reason the PDF pipeline is built the way it is (section 9).
- **Crons run at most once daily.** Anything sub-daily is hit by cron-job.org
  with the `CRON_SECRET` as a bearer token. `vercel.json` holds the daily jobs;
  `/api/cron/work` and `/api/cron/crm-send` are external.
- **No WebSocket hosting.** Live updates come from Supabase Realtime on the
  browser client, not from the Next server.
- **The image optimiser has a quota.** Never put `next/image` in front of a
  Supabase signed URL: the rotating token defeats the cache and burns the quota
  on the same picture. Thumbnails are self-generated WebP at upload time and
  served as plain lazy `<img>`.
- **Supabase image transforms are Pro-only.** Do not rely on them.

### Working setup (repeated here because it bites immediately)

`npm install` does not work inside Google Drive. The Drive folder
(`H:\My Drive\Website Code\hartwell-pulse`) is the source of truth for editing;
a local clone (`C:\Users\Kyle\pulse-verify`) is where `npm run build`,
`npm run typecheck` and `git push` happen. Sync Drive to clone with robocopy
`/E`, never `/MIR`. The two copies differ in line endings on nearly every
top-level file, so diff through `tr -d '\r'`.

`.env.local` on this machine is a skeleton with every secret blank. The live
values exist only in Vercel. `npm run dev` cannot reproduce what the portal
does. Build and typecheck are unaffected.

---

## 2. Route map

Next.js App Router. `src/app/layout.tsx` is the only root layout: it mounts
`ClerkProvider`, loads the four fonts, and inlines `THEME_SCRIPT` into `<head>`.

### Entry

| Route | File | Notes |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | Resolves the session and redirects: admin to `/admin`, client to `/dashboard`. A signed-in Clerk user with no `client_users` row gets an "account is being set up" page. |
| `/sign-in/[[...sign-in]]` | `src/app/sign-in/[[...sign-in]]/page.tsx` | Clerk's prebuilt `<SignIn />`. **There is no sign-up route.** Kyle provisions every account. |

### Client area — the `(client)` route group

Route group, so the URLs carry no `/client` prefix. Guarded by
`src/app/(client)/layout.tsx`, which resolves the session, bounces admins to
`/admin`, bounces anyone without `role === "client"` and a `clientId` to `/`,
and renders a "portal access has ended" page for a soft-deleted client.

| Route | Purpose |
| --- | --- |
| `/dashboard` | Metrics dashboard for the signed-in client. |
| `/reports` | Published reports only (`listClientReports` filters `status = 'published'`). |
| `/reports/[reportId]` | The report viewer. Renders `ReportViewerChrome`, the same component the PDF renderer photographs. |
| `/assets` | Folder-scoped asset browser, `?folder=` for navigation. |
| `/copy` , `/copy/[docId]` | Copy documents, Tiptap editor, versioned. |
| `/website` | Client website previews in an iframe. **The nav tab only appears when the client has at least one visible preview row** (`hasPreview` on `Shell`). |
| `/messages` | Conversations the user is a member of. Also hosts `PushToggle`. |
| `/invoices` | Non-draft invoices for the client. |
| `/invoices/[invoiceId]` | The invoice document, with a print button. Drafts 404. |

### Admin area

Guarded by `src/app/admin/layout.tsx`: not admin, redirect to `/`.

| Route | Purpose |
| --- | --- |
| `/admin` | The dashboard. Work items, not `board_cards`. `dynamic = "force-dynamic"`, nothing cached. |
| `/admin/clients` | Client list, provisioning, lifecycle. |
| `/admin/clients/[clientId]/preview` | See a client's dashboard as they see it. |
| `/admin/reports` , `/admin/reports/new` | Report library, creation. |
| `/admin/reports/[reportId]` | The report editor. |
| `/admin/reports/[reportId]/preview` | Print-ready preview. Deliberately shares the client viewer's `<title>`, because the tab title is the browser's suggested PDF filename. |
| `/admin/assets` | All clients' assets. |
| `/admin/copy` , `/admin/copy/[docId]` | Copy documents across clients. |
| `/admin/messages` | Every thread, plus thread creation. |
| `/admin/invoices` , `/admin/invoices/new` | Invoice library and creation. |
| `/admin/invoices/[invoiceId]` | The invoice builder. Has its own `error.tsx`. |
| `/admin/crm` | The prospect board. `?brand=ironpeak` or `?brand=hartwell`. |
| `/admin/crm/[orgId]` | One prospect: research, contact, touches, composer. |
| `/admin/crm/plan` | The run sheet. Schedule as one table, then overdue follow-ups and sends by day. |
| `/admin/work/recurring` | Recurring work definitions. There is no `/admin/work` index; the dashboard at `/admin` is it. |
| `/admin/settings` | Business settings, pricing items, email templates. |

### Print routes (public, token-gated)

| Route | File |
| --- | --- |
| `/print/report/[reportId]?token=` | `src/app/print/report/[reportId]/page.tsx` |
| `/print/invoice/[invoiceId]?token=` | `src/app/print/invoice/[invoiceId]/page.tsx` |

Both are `dynamic = "force-dynamic"`, both use the service-role client, both
call `printTokenValid(kind, id, token)` and `notFound()` on failure, and both
render `<ForcePrintLight />` plus the exact component a human sees. See
section 9.

### API routes

| Route | Method | Auth | Notes |
| --- | --- | --- | --- |
| `/api/reports/[reportId]/pdf` | POST | `getPulseSession()` role admin | `runtime = "nodejs"`, `maxDuration = 60`. Returns 200 on failure too, with `{ok:false,message}`. |
| `/api/invoices/[invoiceId]/pdf` | POST | same | same |
| `/api/webhooks/resend` | POST | Svix signature | See section 11. |
| `/api/cron/email` | GET | `CRON_SECRET` bearer | Daily 07:00 UTC. Emails pending `channel = 'instant'` notifications. |
| `/api/cron/digest` | GET | same | Mondays 08:00 UTC. Batches `channel = 'digest'`. |
| `/api/cron/overdue` | GET | same | Daily 08:00 UTC. Due-soon heads-up and overdue nudge. |
| `/api/cron/recurring` | GET | same | Daily 06:00 UTC. `maxDuration = 60` because it renders. |
| `/api/cron/purge-clients` | GET | same | Daily 04:00 UTC. 30-day grace, then hard purge of portal data. |
| `/api/cron/crm-reminders` | GET | same | Daily 22:00 UTC. Books re-verify tasks only. |
| `/api/cron/brief` | GET | same | Daily 21:00 UTC = 07:00 Brisbane. The one daily notification for Kyle's own work. |
| `/api/cron/work` | GET | same | **Not in `vercel.json`.** Intended hourly from cron-job.org. |
| `/api/cron/crm-send` | GET | same | **Not in `vercel.json`.** Every few minutes from cron-job.org. Currently should not be running: see the Ironpeak block note in CLAUDE.md. |

### Share and unsubscribe

| Route | Auth | Notes |
| --- | --- | --- |
| `/share/[token]` | Clerk login required (middleware), plus token | Landing page for a shared asset or folder. Increments `use_count`. |
| `/share/[token]/raw` | same | Revalidates the token on **every** file fetch, then 302s to a freshly minted 60-second signed URL. Killing a share kills live file access, not just the landing page. Signed URLs never appear in HTML or email. |
| `/unsubscribe/[token]` | **Public** | Outreach opt-out. Acts on GET. Says the same thing whether or not the token matched, so nobody can test whether an address is on the list. Calls `crm_opt_out(token)` and reads nothing back. Renders the Ironpeak wordmark and nothing Hartwell. |

---

## 3. Middleware: what is public and why

`src/middleware.ts` wraps everything in `clerkMiddleware` and calls
`auth.protect()` on anything not matched by `isPublicRoute`.

```
/sign-in(.*)
/api/webhooks/(.*)
/api/cron/(.*)
/unsubscribe/(.*)
/print/(.*)
```

Each exemption has a reason and each carries its own check:

- **`/sign-in`** — obvious.
- **`/api/webhooks/*`** — Resend has no Clerk session. The route verifies the
  Svix signature itself and 503s if `RESEND_WEBHOOK_SECRET` is unset.
- **`/api/cron/*`** — Vercel Cron and cron-job.org have no login. Every route
  calls `cronAuthorized(req)`, which **fails closed**: a missing `CRON_SECRET`
  is a 503, never an allow.
- **`/unsubscribe/*`** — the person clicking has no account, and requiring one
  to be left alone would be absurd.
- **`/print/*`** — a headless browser cannot hold a Clerk session. The page
  proves the request is ours with an HMAC token (section 9).

**The trailing slashes are load-bearing.** `"/api/cron/(.*)"` anchors the path,
so a sibling like `/api/cron-foo` is *not* exempted. Do not relax these into
`"/api/cron(.*)"`.

The `config.matcher` skips `_next` and static file extensions, and always runs
for `/api` and `/trpc`.

---

## 4. Auth end to end

The chain is: Clerk session → Supabase JWT → `clerk_user_id()` in Postgres →
RLS policies. Application code is not the boundary; it is a convenience layer
on top of a boundary that lives in the database.

### Step 1: Clerk

`ClerkProvider` in `src/app/layout.tsx`. `clerkJSVersion` is pinned to
`5.125.13` deliberately: the v6 SDK's default loads an older Clerk.js that
throws `needs_client_trust not supported yet` on the prebuilt sign-in. Do not
remove the pin without testing the sign-in flow on the production instance.

The Clerk session token needs a `{ "role": "authenticated" }` claim so Postgres
recognises the caller. Set up under Supabase → Authentication → Third Party
Auth → Clerk. With that native integration in place, **the default session
token works and no JWT template is needed.**

### Step 2: `getPulseSession()`

`src/lib/auth/session.ts`. The one place a Clerk user becomes a Pulse identity.

```ts
interface PulseSession {
  clerkUserId: string;
  role: Role | null;      // null when there is no client_users mapping yet
  clientId: string | null; // null for admins
  profile: ClientUser | null;
}
```

It looks the mapping up **with the service-role client**, on purpose: deciding
"who is this and what may they see" is a trusted server decision that must work
before any per-user RLS context exists. The RLS policies remain the real
boundary for every actual data query.

A lookup **error** throws. A missing **row** returns a session with
`role: null`. Those are different things: an error is a bad service key, a DB
outage or a grant misconfiguration, and silently degrading everyone to
"unprovisioned" would mask a security-relevant fault. A missing row is a person
who has signed in before Kyle finished connecting their account, which is a
normal state with its own page.

Helpers `isAdmin(session)` and `isClient(session)` are thin.

### Step 3: the Postgres helpers (migration 0002)

```sql
clerk_user_id()      -- auth.jwt() ->> 'sub'          (stable)
is_admin()           -- exists(client_users where clerk_user_id = sub and role='admin')
current_client_id()  -- client_users.client_id for that sub
```

`is_admin()` and `current_client_id()` are `SECURITY DEFINER` with
`search_path = public`, so they can read `client_users` without tripping its own
RLS and recursing. `clerk_user_id()` is a plain stable function.

Privileges: `authenticated` gets `usage` on `public`, `execute` on the three
helpers, and `select, insert, update, delete` on all tables. RLS still filters
every row; the grants only let the role touch the tables at all. `anon` gets
nothing. `service_role` bypasses RLS entirely.

### Step 4: the policy shape

Every client-facing table follows one of two shapes:

```sql
-- admin sees everything
create policy X_admin_all on public.X
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- client sees only their own
create policy X_client_read on public.X
  for select to authenticated
  using (client_id = public.current_client_id());
```

`client_users` is the exception: a user reads only their own mapping row, keyed
on `clerk_user_id = clerk_user_id()`, not on client_id. `api_connections` is
admin-only with no client policy at all, because clients must never read
credentials. All `crm_*` tables and all `work_item*` tables are admin-only
(0044 generates those policies in a `do $$` loop).

### Step 5: the cascade gap

**Postgres FK cascades do not re-check RLS.** A `RESTRICTIVE` delete policy on
a parent will not stop a cascade from wiping a child the caller should not
touch. The pattern is a `BEFORE DELETE` trigger, which *does* fire on
cascade-deleted rows. See `supabase/migrations/0011_permissions.sql`
(`asset_folders_delete_guard`) for the worked example, and 0017 for the
conversations equivalent. Any new cascade path needs the same treatment.

### Storage tenancy (migration 0003)

Two private buckets, `pulse-assets` and `pulse-reports`. The convention that
makes RLS work:

> **The client_id is the FIRST path segment of every object key.**

`pulse-assets/<client_id>/social/header.png`.
`pulse-reports/<client_id>/<document_id>/pdf/<ts>-<name>.pdf`.

Policies key off `(storage.foldername(name))[1] = current_client_id()::text`.
`pulse-assets` lets clients read, insert, update and delete inside their own
prefix. `pulse-reports` is admin-write, client-read.

Nothing is ever served from a public URL. Signed URLs are minted at 60 seconds
for share-link fetches and one hour for in-portal asset and report images.

---

## 5. The three Supabase clients, and the rule for choosing

This is the decision that gets made wrong most often, so it is spelled out.

| Flavour | File | Runs as | Where it may be used |
| --- | --- | --- | --- |
| **Browser RLS** | `src/lib/supabase/client.ts` → `useSupabaseClient()` | The signed-in user | Client Components only. Memoised on `session.id`, fetches a fresh Clerk token per request via the `accessToken()` callback. |
| **Server RLS** | `src/lib/supabase/server.ts` → `await createServerSupabase()` | The signed-in user | Server Components, Route Handlers, Server Actions. Forwards the Clerk token; RLS applies. |
| **Service role** | `src/lib/supabase/admin.ts` → `createAdminSupabase()` | Nobody. **Bypasses RLS entirely.** | Trusted server code only, and only after an explicit access check. |

Both server flavours are marked `import "server-only"`. The service key must
never reach the browser.

### The rule

> **Default to the RLS client. Reach for the service role only when there is a
> specific reason RLS cannot serve the request, and only after the code has
> already established who the caller is and that they are allowed.**

Because the service role bypasses RLS, **any code using it owns its own access
control.** That is not a slogan; it is why `getPulseSession()` runs first in
every route handler and every service-role server action.

### The legitimate service-role uses, and why each one qualifies

There are seven categories, and they are all in the tree today:

1. **Identity resolution.** `getPulseSession()` itself. It has to work before
   RLS context exists.
2. **Cron jobs.** `/api/cron/*`. There is no user. `cronAuthorized()` is the
   gate. Every one of them uses `createAdminSupabase()`.
3. **Webhook handlers.** `/api/webhooks/resend`. Resend is not a user. The Svix
   signature is the gate.
4. **The print routes.** `/print/report/*` and `/print/invoice/*`. A headless
   browser has no session. The HMAC print token is the gate.
5. **Provisioning across clients.** `src/app/admin/clients/actions.ts` and
   `src/app/admin/messages/actions.ts`. Creating a client, adding a user,
   starting a conversation: these read and write rows across every client, which
   is exactly what RLS forbids. Both files gate on
   `session?.role !== "admin"` first (`requireAdmin()`).
6. **PDF rendering.** `/api/*/pdf` route handlers pass a service-role client
   into `renderAndAttach`, because the render writes a row and a storage object
   after the admin check has already passed.
7. **Two narrow reads for the client's own benefit.**
   `src/app/(client)/reports/[reportId]/page.tsx` and
   `src/app/(client)/invoices/[invoiceId]/page.tsx` fetch
   `business_settings` with the service role. `business_settings` is admin-only
   under RLS, but the letterhead and bank details on a document are *meant* for
   the client to read. These are Server Components and only the letterhead
   fields are rendered. If you ever render more of that row on a client-facing
   page, you are leaking admin settings.

Also service-role by nature: `src/lib/push.ts` (push subscriptions are sending
credentials), `src/lib/shares.ts` (share tokens are checked before any identity
exists), `src/lib/email.ts`'s `recordEmail` (telemetry that must not be
RLS-blocked), and `src/lib/actions/push.ts`.

### The counter-example worth internalising

`src/app/actions/search.ts` — `searchEverything()` — runs on the **server RLS**
client and sweeps clients, invoices, reports, assets, copy documents and CRM
organisations in one `Promise.all`. It is safe not because it checks roles but
because RLS answers each query correctly for whoever is asking: a client gets
their own invoices, and `crm_organisations` returns nothing at all for them.
Writing a second access-control system inside that action would be a second
thing to keep in step with the first.

> **Stale claim, corrected.** CLAUDE.md says this action has "NO role branching
> on purpose". It does branch on `isAdmin`, in two ways: it skips the `clients`
> and `crm_organisations` queries entirely for non-admins, and it picks
> `/admin/...` versus client hrefs from the same flag. The *safety* argument is
> unchanged (RLS is still what makes it correct), but the description is no
> longer accurate. Treat the intent as "RLS is the access control here, the
> role flag is only a short-circuit and a link chooser".

---

## 6. The `src/lib` module map

What each file owns. Files marked **server** carry `import "server-only"` and
cannot be imported from a Client Component. Files marked **shared** are
deliberately free of Node and Supabase imports so both sides can use them.

### Auth and data access

| File | Owns |
| --- | --- |
| `auth/session.ts` **server** | `getPulseSession()`, `isAdmin()`, `isClient()`. The only place Clerk becomes Pulse identity. |
| `supabase/client.ts` | `useSupabaseClient()`, the browser RLS client. |
| `supabase/server.ts` **server** | `createServerSupabase()`, the server RLS client. |
| `supabase/admin.ts` **server** | `createAdminSupabase()`, the service-role client. |
| `types/database.ts` | Hand-maintained row interfaces and union types for every table. `Brand = "hartwell" | "ironpeak"` lives here. Not generated: keep it in step with migrations by hand. |
| `utils/cn.ts` | `cn()`, clsx + tailwind-merge. The only class merger. |

### Documents: invoices and reports

| File | Owns |
| --- | --- |
| `invoices.ts` **server** | Reads: `getInvoiceBundle`, `listAdminInvoices`, `listClientInvoices`, `getBusinessSettings`, `listPricingItems`. |
| `invoices-shared.ts` **shared** | `computeTotals` (the GST and discount maths), `lineAmount`, `formatMoney`, `gstLabel`, `DEFAULT_INVOICE_EMAIL`, `InvoiceBundle`. |
| `invoices-send.ts` **server** | `sendInvoiceWith()` and `invoiceRecipients()`. **One of exactly two places email attachments are wired.** |
| `reports.ts` **server** | `getReportBundle`, `getReportMetricData`, `listAdminReports`, `listClientReports`, `listSnippets`, `resolveImageUrls`. |
| `reports-shared.ts` **shared** | `ReportBlock`, `ReportSectionContent` (including `pageBreak`), `SectionInput`, `sectionBlocks`, `metricKeyOf`, `DEFAULT_REPORT_EMAIL`. |
| `reports-send.ts` **server** | `sendReportWith()`. **The other place attachments are wired.** |
| `recipients.ts` **server** | `resolveRecipients()` and `firstName()`. **The single implementation of who a document goes to.** Empty `chosen` means everyone on the account; an empty *result* means stop. |
| `brand.ts` | `HARTWELL`, `IRONPEAK`, `isIronpeak()`, `IRONPEAK_DOC_CLASS`. Section 8. |

### The PDF pipeline

| File | Owns |
| --- | --- |
| `pdf-render.ts` **server** | `renderAndAttach()` and `documentNames()`. The single Chromium launch. |
| `report-pdf.ts` **server** | `renderReportPdf()`. Thin: looks the report up, calls `renderAndAttach` with report-shaped arguments. |
| `invoice-pdf.ts` **server** | `renderInvoicePdf()`. Same shape, invoice arguments. |
| `print-token.ts` **server** | `printTokenFor()` and `printTokenValid()`. HMAC over `kind.id.expiry`. |
| `pdf-client.ts` | `requestDocumentPdf(kind, id)`. A plain `fetch` from the browser to the route handler. |

### Email

| File | Owns |
| --- | --- |
| `email.ts` **server** | `sendEmail()` (writes an `email_events` row every time), `emailLayout()`, `renderMessage()`, `escapeHtml()`, `EmailAttachment`. |
| `email-delivery.ts` **shared** | `deliveryFor()`: match one send to its nearest-after delivery event, with a minute of slack for clock skew. |
| `svix-verify.ts` **server** | `verifySvix()`. Hand-rolled rather than pulling in `svix` for one route. The 5-minute timestamp tolerance is what stops replay. |

### Notifications and push

| File | Owns |
| --- | --- |
| `push.ts` **server** | `pushToUsers()`, `pushConfigured()`. Deletes dead subscriptions on 404/410. |
| `actions/push.ts` (`"use server"`) | `savePushSubscription`, `removePushSubscription`, `sendTestPush`, `notifyNewMessage`. |

### Assets, folders, shares

| File | Owns |
| --- | --- |
| `assets.ts` **server** | `signAssets()`: batch-sign originals and thumbnails in one round trip. |
| `assets-shared.ts` **shared** | `AssetWithUrl`, `ASSET_FOLDERS`, `ASSET_TAGS`, `TAG_TONE`, `kindFromMime`, `isImageMime`, `folderSlug`, `formatBytes`. |
| `folders.ts` **server** | `getClientFolders()` and `buildFolderView()` (breadcrumb and children built in memory, no recursive query). |
| `shares.ts` **server** | `hashToken()`, `resolveShare()`. Fails closed on unknown, revoked, expired and used-up. |
| `actions/shares.ts` (`"use server"`) | `createShare()`. Raw token returned once; only the hash is stored. Target resolved under RLS, so you can only share what you can already see. |

### Dashboard and metrics

| File | Owns |
| --- | --- |
| `dashboard.ts` **server** | `getClientDashboardData()`. Always filters by `client_id` explicitly, which is what pins the admin preview to one client (RLS alone would let an admin see all). |
| `metrics.ts` **shared** | `METRIC_META` (which direction is good news), `formatMetricValue`, `computeDelta`, `formatDeltaPct`, `monthLabel`. This is where "a falling cost per lead is green" lives. |

### Work items (the dashboard rebuild, 0044 to 0046)

| File | Owns |
| --- | --- |
| `work-shared.ts` **shared** | `WorkItem`, `WorkStep`, `WorkRow`, `bucketFor`, `daysOverdue`, `isSnoozed`. |
| `work.ts` **server** | `listWork()`, `getWorkStrip()`. Three plain reads stitched, not an embedded join. |
| `work-generate.ts` **server** | `generateWorkItems()`. Turns invoices, reports, CRM sends and CRM tasks into work items. Idempotent through the partial unique index. |
| `work-recurrence.ts` **server** | `materialiseRecurrences()`, `nextDue()`. Weekly, monthly, quarterly, annual. |
| `work-nudge.ts` **server** | `nudgeTimedItems()`. One nudge per `has_time` item, gated on `nudged_at`. |

### CRM

| File | Owns |
| --- | --- |
| `crm.ts` | Queries. Takes the caller's client so RLS applies; `crm_*` is admin-only, so a client session sees nothing. |
| `crm-shared.ts` **shared** | `CRM_STAGES`, outcomes, the Ironpeak accent. No Supabase or Node imports. |
| `crm-send.ts` **server** | `draftOutreach()`, `buildOutreachText()`, `SIGNATURE`. The signature and opt-out are appended here, never stored in a body. |
| `crm-presend.ts` **shared** | `PRESEND_CHECKS`, the nine checks, in one place, imported by both the manual and automated flows. |
| `crm-unresolved.ts` **server** | The seven drafted-but-unconfirmed sends, as written-down constants. Deliberately not a query: the evidence (`draft_created_at`) is cleared by `replacePipeline`. |
| `crm-pipeline-v2.ts` | 67 KB of generated data. **Never hand-edit.** Generated by `scripts/gen-pipeline.py` from `portal-handoff-pipeline.md` in the Ironpeak Drive folder. |
| `graph.ts` **server** | Microsoft Graph client-credentials token and `graphCreateDraft`. `graphSendMail` was deleted, not left unused. |

### Shell and chrome

| File | Owns |
| --- | --- |
| `nav.ts` | `clientNav`, `adminNav`, `isNavActive`. |
| `celebrate.ts` | `celebrate()`. Fires on outcomes, never activity. Honours `prefers-reduced-motion`. |
| `cron-auth.ts` **server** | `cronAuthorized()`. Fails closed. |
| `board-shared.ts` **shared** | Legacy `board_cards` columns and card types. Kept while `board_cards` is kept. |

---

## 7. Server actions

Writes go through Server Actions, one file per domain, all under `src/app`:

| File | Lines | Gate |
| --- | --- | --- |
| `src/app/actions/search.ts` | ~157 | `getPulseSession()`, RLS does the rest |
| `src/app/admin/invoices/actions.ts` | 413 | local `adminSupabase()` → throws unless admin, returns **server RLS** client |
| `src/app/admin/reports/actions.ts` | 571 | same |
| `src/app/admin/crm/actions.ts` | 1161 | same |
| `src/app/admin/work/actions.ts` | 372 | same |
| `src/app/admin/clients/actions.ts` | 482 | `requireAdmin()` → **service role** (provisioning crosses clients) |
| `src/app/admin/messages/actions.ts` | 189 | `requireAdmin()` → **service role** (threads cross clients) |
| `src/lib/actions/push.ts` | | `getPulseSession()` → service role, scoped to the caller's own rows |
| `src/lib/actions/shares.ts` | | `getPulseSession()` → server RLS |

Note the split: **invoices, reports, CRM and work actions run on the RLS
client** even though the caller is an admin. That is deliberate belt and braces.
Clients and messages need the service role because they write across the client
boundary by nature.

### The money rule, in code

`saveInvoice` in `src/app/admin/invoices/actions.ts:99`:

```ts
if (invErr) throw new Error(`Could not save the invoice: ${invErr.message}`);
```

That line exists because it did not. A migration added a column that had not yet
been applied, the update was rejected silently, the invoice kept its defaults,
and a client was emailed an invoice for $0.00 on the wrong terms.
**Every write on the money path checks its error.** Adding a column to an
existing write is exactly the moment this bites, because code ships before the
migration is run.

---

## 8. The dual-brand mechanism

Hartwell Digital and Ironpeak Consulting are the **same legal entity and the
same ABN**. Ironpeak is a registered business name against Hartwell Digital's
ABN 44 286 503 049, trading in defence only.

**Client-facing Ironpeak output must never mention Hartwell Digital.** No "a
business of Hartwell Digital", no second logo, no phone number. The bare ABN
line is the only permitted expression of the parent, and it needs no
explanation. Internal surfaces may say it; anything a prospect or Ironpeak
client can see may not.

### Three moving parts

**1. The data.** `invoices.brand` and `reports.brand`, both
`'hartwell' | 'ironpeak'` (migrations 0023 and 0030). `crm_organisations.brand`
splits the CRM into two pipelines (0025).

**2. The identity.** `src/lib/brand.ts` holds `IRONPEAK` and `HARTWELL` as
frozen objects. Every document reads the **ABN from `business_settings`**, not
from here, because the ABN is the same for both. Never re-declare the Ironpeak
name, email or location in a component.

**3. The presentation.** One exported constant:

```ts
export const IRONPEAK_DOC_CLASS = "doc-light brand-ironpeak";
```

Applied in exactly three places, all in `src/components`:

- `reports/ReportViewerChrome.tsx:103`
- `invoices/InvoiceDocument.tsx:42`
- (`reports/ReportLetterhead.tsx` reads `isIronpeak()` to choose the wordmark
  and contact block, not the class.)

### What the two classes do

`doc-light` (`src/app/globals.css:212`) re-points the brand tokens to a white
sheet and swaps gold for steel:

```
--pulse-bg: #ffffff        --pulse-gold: #4a6c96
--pulse-surface: #ffffff   --pulse-gold-light: #7fa0c8
--pulse-text: #0e0f12      ...
```

Ironpeak's own brand is near-black, but a dark invoice is hostile to print,
burns toner, and reads as a novelty rather than a financial document.

`brand-ironpeak` (`globals.css:231`) brings the real typography: Hanken Grotesk
for body, Clash Display for `h1`, `h2` and `.font-display`, Geist Mono for
`.data-mono`, `.mono-label` and `table`. Both classes are scoped, so nothing
leaks onto a Hartwell surface.

**Clash Display has no tabular figures.** At weight 700 the digit `1` is 40.7px
against `0` at 73.3px, so `font-variant-numeric` is a no-op and a column of
numbers set in it will not line up. Every figure, total and date on an Ironpeak
document goes in Geist Mono. This is documented at the top of `globals.css` and
is the reason `.brand-ironpeak table` exists as a selector.

### The rule that makes it work

> **A document must never hardcode a colour.** Chart strokes, bars and fills
> read `--pulse-gold`, which `doc-light` swaps for steel.

That is what lets one `ReportDocument`, one `InvoiceDocument` and one
`MetricChart` serve both brands with no prop threaded down. See the comment at
`src/components/dashboard/MetricChart.tsx:54`.

### Fonts

`src/app/layout.tsx` loads four families and puts all four variables on `<html>`
every time:

| Variable | Family | Used by |
| --- | --- | --- |
| `--font-outfit` | Outfit (next/font) | Pulse sans, the default |
| `--font-jetbrains` | JetBrains Mono (next/font) | Pulse mono, `.data-mono` |
| `--font-hanken` | Hanken Grotesk (next/font) | Ironpeak body |
| `--font-geist-mono` | Geist Mono (next/font) | Ironpeak figures |

Clash Display is **self-hosted** from `public/fonts/` via two `@font-face`
rules at the top of `globals.css` (Semibold 600 and Bold 700, woff2, free for
commercial use from Fontshare). It is not a Google font and cannot be loaded
through `next/font`.

---

## 9. The PDF pipeline

This is the most intricate subsystem and the one with the most hard-won rules.

### The governing constraint

> **NOTHING renders inside a server action. Ever.**

A server action inherits the calling page's ten-second limit on Vercel Hobby,
and it cannot be raised. A cold Chromium start does not finish in ten seconds.
The invoice send did render inline, once, and pressing Send hung and died with
a blank screen. `maxDuration` can only be set on a route handler or a page, so
**rendering happens in route handlers**, which ask for sixty.

### The four render entry points

| Caller | Path | Failure behaviour |
| --- | --- | --- |
| Report editor, on **publish** | `ReportEditor.tsx:314` → `requestDocumentPdf("report", id)` → `POST /api/reports/[id]/pdf` | Publish still succeeds. Previous PDF untouched. The card offers "Make it again" or an upload. |
| Invoice builder, before **send** | `InvoiceBuilder.tsx:250` → `requestDocumentPdf("invoice", id)` → `POST /api/invoices/[id]/pdf` | Deliberately ignored. The send proceeds carrying a link. |
| `DocumentPdf` card, on demand | `DocumentPdf.tsx:71`, either kind | Shows the message. |
| Recurring cron | `/api/cron/recurring` → `tryRenderPdf()` → `renderInvoicePdf()` directly | Logged with `console.warn`, send proceeds. |

Note that the recurring cron calls the renderer **in process** rather than over
HTTP, which is why that route also declares `runtime = "nodejs"` and
`maxDuration = 60`.

### The flow, step by step

1. Browser calls `requestDocumentPdf(kind, id)` (`src/lib/pdf-client.ts`), a
   plain `fetch` POST. Not a server action, because only a route can ask for
   sixty seconds.
2. The route handler checks `getPulseSession()?.role === "admin"`, 403s
   otherwise, and resolves the origin as
   `NEXT_PUBLIC_APP_URL` first, `req.nextUrl.origin` as a fallback for preview
   deployments.
3. It calls `renderReportPdf` / `renderInvoicePdf` with a **service-role**
   client. The admin check above is the gate; the render writes a row and a
   storage object.
4. Those thin wrappers read the row for `client_id`, the name and the previous
   `pdf_path`, then call `renderAndAttach` in `src/lib/pdf-render.ts`.
5. `renderAndAttach` mints a print token, launches Chromium, opens
   `/{origin}/print/{kind}/{id}?token=...`, takes an A4 PDF, uploads it, and
   points the row at it.
6. The route returns **200 either way**, with `{ok:true,name}` or
   `{ok:false,message}`. A failed render is an outcome the editor shows, not an
   exception, because the whole design is that a failure leaves the previous PDF
   alone and the manual upload still works.

### Inside `renderAndAttach`

Every one of these details was arrived at by something going wrong:

- **Chromium is imported inside the function**, not at module top, so the ~67 MB
  is only touched by a request that needs it.
- **`page.evaluateOnNewDocument` seeds `localStorage["pulse-theme"] = "light"`
  before any navigation.** The portal defaults to dark and a fresh headless
  profile has no theme stored. Seeding after navigation would flash and would
  not repaint what had already been drawn.
- **`page.emulateMediaType("print")`.**
- **`waitUntil: "networkidle0"`, not `"load"`.** The letterhead and any
  screenshots are signed Storage URLs fetched after first paint. A PDF taken on
  `load` has holes in it. Timeout 45 seconds.
- **`printBackground: true`** — the document draws its own letterhead and
  colours, and a PDF that drops them is not the document.
- **`preferCSSPageSize: true`** — `globals.css` already sets
  `@page { margin: 18mm 16mm }`. Passing numbers here as well would give the
  document two answers to one question.
- **Non-OK response returns early** with the status, rather than photographing
  an error page.
- **`browser.close()` in a `finally`.**

### Two names, not one

`documentNames(raw, fallback)` returns `{ fileName, keyName }`:

- `fileName` strips only the characters a filesystem genuinely refuses
  (`\ / : * ? " < > |`) and collapses whitespace. This is what the client sees.
- `keyName` is NFKD-normalised, stripped of combining marks, folded to
  `[a-z0-9-]`. This is the storage object key.

They used to be the same string, and sanitising for storage is what turned
"Haús of Vitality" into "Haus of Vitality" on a document addressed to her.

### The write ordering

```
upload to pulse-reports  →  update the row  →  delete the previous file
```

- Upload uses `upsert: false` and a `Date.now()`-prefixed key, so it never
  collides.
- **The row update is checked.** An unchecked write here leaves the new file in
  storage while the row still points at the old one, and the next send goes out
  carrying a document that has since changed. On failure it removes the file it
  just uploaded and returns the error.
- The previous file is removed **only after** the row points at the new one. Any
  earlier and a failed update leaves the row pointing at something gone.

The bucket is `pulse-reports` for **both** kinds. Invoices live there too. Path
shape: `{clientId}/{documentId}/pdf/{timestamp}-{keyName}.pdf`, which satisfies
the storage RLS rule that client_id is the first segment.

### The print token

`src/lib/print-token.ts`. HMAC-SHA256 over `` `${kind}.${id}.${expiry}` ``,
returned as `` `${expiry}.${hex}` ``. TTL five minutes.

- **The KIND is signed alongside the id**, so a token minted for a report cannot
  be pointed at the invoice that happens to share its uuid space. Both print
  routes are public and this signature is the only thing between them and the
  world.
- **Signed with `CRON_SECRET`**, not a variable of its own. It is already
  required, already server-only, and already the shared secret this deployment
  uses to prove a request came from itself. One more environment variable that
  silently disables a feature when unset was judged the worse trade.
- Expiry is checked **before** the comparison, so an expired token costs
  nothing.
- Length is checked before `timingSafeEqual`, which throws on unequal buffers
  rather than returning false.
- `printTokenFor` returns `null` when `CRON_SECRET` is unset, and
  `renderAndAttach` turns that into a readable message rather than a crash.

### The print pages

Both render `<ForcePrintLight />` and then **the exact component a human sees**:
`ReportViewerChrome` for reports, `InvoiceDocument` for invoices. Not a
print-only twin. Two documents drift the first time only one of them changes,
and on an invoice that means the attachment and the portal disagreeing about the
amount. The chrome already carries `no-print`, so the print stylesheet removes
the navigation and search box on its own.

An invalid token gets `notFound()`, not a message: an unsigned request should
not learn whether the id it guessed exists.

`generateMetadata` on both sets the title to `{client} - {document}`, because
the browser turns the tab title into the suggested PDF filename. The admin
preview page uses the identical title for the same reason. A file called
"Report preview.pdf" reaching a client is a mistake.

### The Chromium deployment configuration

`next.config.mjs` does two separate things, and both are necessary:

```js
serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
outputFileTracingIncludes: {
  "/api/reports/[reportId]/pdf": ["./node_modules/@sparticuz/chromium/**/*"],
  "/api/reports/**":            ["./node_modules/@sparticuz/chromium/**/*"],
},
```

- `serverExternalPackages` keeps the binary out of the webpack bundle. Bundled,
  the executable never arrives and the launch fails on a path that does not
  exist.
- `outputFileTracingIncludes` is the other half. Nothing *imports* the binary,
  it is read off disk at runtime, so Next's file tracer has no reason to copy it
  into the deployed function and does not. The symptom is a route that starts
  fine and then reports `node_modules/@sparticuz/chromium/bin does not exist`.
  Naming the package here is what puts it in the upload.
- It is scoped to specific routes on purpose. Applied broadly it would add tens
  of megabytes to every function in the deployment.

**See "Risks and gaps" — the tracing includes cover the report routes only.**

### The rules that must not be inverted

- **A report send stops if its attachment cannot be read.** A person is there to
  read the message, and a send that quietly drops the PDF looks identical to one
  that never had it (`reports-send.ts:74-92`).
- **An invoice send never stops for a missing PDF.** The recurring cron sends
  invoices with nobody watching, and an invoice that does not arrive is worse
  than one that arrives carrying a link (`invoices-send.ts:112-131`, which
  `console.warn`s and continues).
- **Rendering is off the report send path entirely.** It happens on publish. A
  failed render leaves the previous PDF alone, says why, and the manual upload
  still works exactly as it did.
- **`pdf_uploaded_at` older than the document's `updated_at` means the
  attachment is stale**, and the editor says so. Nothing can tell that from the
  file itself, so the two timestamps are simply shown to disagree.

---

## 10. Service worker and web push

`public/sw.js`. **Push only, no offline or caching layer.** The portal is
always live data and a stale cache would be worse than a spinner. Do not add a
fetch handler to it casually.

- `install` → `skipWaiting()`, `activate` → `clients.claim()`. A new worker
  takes over immediately.
- `push` → parses the JSON payload defensively, shows a notification with
  `tag: data.tag || "pulse-message"` and `renotify: true`. The same tag per
  conversation means a second message replaces the first rather than stacking
  five notifications for one thread.
- `notificationclick` → closes, then: focus a window already on that URL,
  otherwise focus any portal window and navigate it, otherwise open a new one.
  In that order, so it never opens a duplicate tab.

### Registration and subscription

`src/components/notifications/PushToggle.tsx` handles the whole lifecycle. It
registers `/sw.js`, waits for `navigator.serviceWorker.ready`, subscribes with
the VAPID public key, and posts the subscription to `savePushSubscription`.

States it distinguishes: `unsupported`, `ios-needs-install`, `off`, `on`,
`blocked`. **iOS only grants web push to a site added to the Home Screen**,
which is why `src/app/layout.tsx` declares
`manifest: "/manifest.webmanifest"` and `appleWebApp: { capable: true }`, and
why `public/manifest.webmanifest` sets `display: "standalone"`.

`urlBase64ToUint8Array` builds the key over a real `ArrayBuffer`. Its return
type is inferred deliberately: annotating it as plain `Uint8Array` widens the
buffer to `ArrayBufferLike`, which no longer satisfies `BufferSource`.

### Sending

`src/lib/push.ts` → `pushToUsers(clerkUserIds, payload)`. Service role, because
subscriptions are sending credentials. It fans out with `Promise.all`, deletes
subscriptions that come back 404 or 410 (a phone that reinstalled or revoked
permission should stop costing a request per message), and stamps
`last_success_at` on the survivors as best-effort bookkeeping.

`pushConfigured()` exists so a caller can tell "nobody has subscribed" apart
from "push is not switched on yet". Those need opposite fixes and look identical
from the browser.

### What actually pushes

Only two things call `pushToUsers`:

1. `notifyNewMessage(messageId)` — a chat message, fired by the sender right
   after the insert. Everything shown is **read back from the database**; the
   caller supplies only the message id, so a preview cannot be spoofed. It
   verifies `message.sender_user_id === session.clerkUserId`, so only the sender
   can trigger their own message's push. Admins and clients get different URLs.
2. `sendTestPush()` — the diagnostic button.

**Everything else notifies by inserting a `notifications` row**, which the
in-portal bell reads live and `/api/cron/email` emails once a day. Invoices,
reports, the morning brief and the timed nudges all take that path. See "Risks
and gaps" on the timing consequence.

---

## 11. Email delivery

Not strictly architecture, but the pipeline crosses enough files to belong here.

```
sendEmail()  →  Resend API  →  email_events row (status: sent | failed)
                     ↓
            Resend webhook  →  /api/webhooks/resend  →  status moves FORWARD only
```

- **Every `sendEmail` writes an `email_events` row.** `recordEmail` swallows its
  own failures after logging: telemetry that can stop an invoice reaching a
  client is worse than no telemetry.
- **Status only ever moves forward through `RANK`.** Webhooks arrive out of
  order and a late "sent" must never overwrite a "bounced". Terminal outcomes
  (`failed` 90, `complained` 95, `bounced` 99) outrank everything.
- The webhook 503s without `RESEND_WEBHOOK_SECRET`, 400s on a bad signature or
  payload, and acknowledges unknown events with `{ok:true,ignored:true}` so
  Resend stops retrying.
- **"Sent" renders grey, not green** in the UI. The gap between "we sent it" and
  "it arrived" is the entire point of the table.
- `deliveryFor()` matches a send to its result by "earliest event for that
  address at or after this send, minus a minute of slack". An email row carries
  no send id, and giving it one would mean the sender knowing about its own
  audit trail.

**Attachments are wired in exactly two places** and nowhere else:
`src/lib/invoices-send.ts` and `src/lib/reports-send.ts`. Both fetch the file
once, before the recipient loop, and base64 it for Resend. The due-soon
heads-up and the overdue nudge in `src/app/api/cron/overdue/route.ts` send HTML
plus a portal link and attach nothing. That is a known gap, recorded below.

Outreach never touches Resend. Resend sends as `hartwelldigital.com`, the domain
carrying every invoice and client notification, and cold mail there would risk
the reputation of the mail that pays. Ironpeak goes through Microsoft Graph,
and currently only as far as a Drafts folder.

---

## 12. Theming and the light-mode token rules

### The mechanism

- Tokens are CSS custom properties on `:root` in `src/app/globals.css`, mapped
  into Tailwind through `@theme inline` so `bg-pulse-surface`,
  `text-pulse-gold`, `border-pulse-border` all work.
- **Light mode is `:root[data-theme="light"]`.** There is no `.dark` class and
  no Tailwind `dark:` variant in play.
- `THEME_SCRIPT` (exported from `src/components/ui/ThemeToggle.tsx`) is inlined
  into `<head>` by the root layout. **It must run before first paint** or every
  load flashes dark then flips. It reads `localStorage["pulse-theme"]` and sets
  the attribute.
- `ThemeToggle` reads what the head script already decided rather than deciding
  again, so the two cannot disagree.
- `suppressHydrationWarning` on `<html>` because the script mutates it before
  React arrives.

### Dark is the default and `prefers-color-scheme` is deliberately NOT read

The portal looking different to a client than it does to Kyle, because of an OS
setting neither of them chose, is a support question. Light is a choice someone
makes in the portal.

### The rules that catch people out

**1. The light gold is a different gold, and `gold-light` goes darker.**

```
dark:   --pulse-gold: #b5a675    --pulse-gold-light: #cbbe97
light:  --pulse-gold: #8a7645    --pulse-gold-light: #6d5c35
```

`#b5a675` is about 2.3:1 on white: fine as a hairline, unreadable as text or as
a button fill. `gold-light` means "more prominent on hover", not "literally
lighter", so on a light background it darkens. **Never assume a token flips to
its literal opposite.**

**2. `color-scheme` is not decoration; it paints the page canvas.**

`globals.css` sets `html { color-scheme: dark }` and
`:root[data-theme="light"] { color-scheme: light }`. The canvas is the margin
area of a printed sheet, outside the `html` box and beyond the reach of any
background property. Left at dark, a light page prints as a light document
inside a black border. This took four attempts to find and is commented as such
in both `globals.css` and `ForcePrintLight.tsx`.

**3. The `@media print` token block lists all three root selectors.**

```css
:root,
:root[data-theme="light"],
:root[data-theme="dark"] { ... }
```

A bare `:root` is less specific than `:root[data-theme="light"]` and would lose.
Paper is paper whichever theme the screen was in.

**4. `ForcePrintLight` states the palette outright, with no media query.**

`src/components/reports/ForcePrintLight.tsx` emits an inline `<style>` with the
same values as the print block plus `color-scheme: light !important` and a white
background on `html, body`. No media query and no `@layer`, so there is no
cascade to lose and no dependence on the renderer emulating print. It is
rendered on **both** print routes and the admin preview, because Kyle prints one
by hand and Chromium photographs the other, and fixing one is fixing half.

If the print block's values ever change, these change with them. A mismatch
means a hand-printed PDF and a generated one no longer look the same.

**5. `.doc-light` is a third palette, not the light theme.**

It is a utility class for a document surface (section 8), whiter and cooler than
the light theme, with steel replacing gold. A page can be in dark theme and
still contain a `doc-light` document.

**6. Clerk's appearance is hardcoded dark.**

`src/app/layout.tsx` passes literal hex values to `ClerkProvider`'s
`variables`, so the UserButton popover stays dark in light mode. Left alone
rather than risking auth UI that cannot be tested locally (`.env.local` has no
Clerk keys).

### Print pagination

All in the `@media print` block of `globals.css`:

- `@page { margin: 18mm 16mm }`. A little more at head and foot than at the
  sides, which is how a document reads on paper. `preferCSSPageSize: true` in
  the renderer defers to this.
- `.no-print` hidden, `.print-only` shown, `.print-reset` unpadded.
- `.report-block`, `.report-figure`, `figure`, `li`, `figcaption` get
  `break-inside: avoid`. A card, chart or figure is one idea.
- Headings get `break-after: avoid` so they stay with their text.
- Paragraphs and table cells use `orphans: 3; widows: 3`, **not**
  `break-inside: avoid`, because a long paragraph *should* be allowed to flow
  across a page.
- `.report-figure img { max-height: 230mm; object-fit: contain }` so a tall
  screenshot is letterboxed rather than running off the bottom.
- `report-page-break` on a section starts a new page. It is toggled per section
  in the editor and stored in the section's JSON `content`
  (`ReportSectionContent.pageBreak`), which is why it needed no migration. CSS
  can stop a heading being orphaned but it cannot know that a section is a new
  chapter; that is the one judgement only the writer can make.

---

## 13. Database migrations

`supabase/migrations/`, numbered `0001` to `0046`. **They are not
auto-applied**: Kyle pastes them into the Supabase SQL Editor by hand.

### Applied state, settled

> **All 46 migrations, 0001 to 0046, are confirmed applied in production.**
> Established 2 September 2026 by probing the live database for the signature
> table or column of each one: 34 probes, 0 missing.

This **supersedes** CLAUDE.md's older note that "0035 to 0041 were confirmed
applied on 18 August 2026" and "everything below 0035 is assumed applied on the
strength of the features working". That uncertainty is resolved. Say so plainly
and do not re-litigate it.

Applied state is still not tracked anywhere in the database or the repo, so the
*method* remains relevant for anything added after 0046: probe, do not assume.
`information_schema.columns` for a column, `pg_proc.prosrc` for what a function
body actually says, `pg_get_constraintdef` for a check constraint.

### Writing a migration

Idempotent, always. `add column if not exists`, `create table if not exists`,
`drop policy if exists` before `create policy` (Postgres has **no**
`CREATE POLICY IF NOT EXISTS`), `drop trigger if exists`, guarded `do $$`
blocks.

### The tables, by group

| Group | Tables |
| --- | --- |
| Tenancy | `clients`, `client_users` |
| Metrics | `services`, `api_connections`, `metrics` |
| Reports | `reports`, `report_sections`, `insight_snippets` |
| Assets | `assets`, `asset_folders`, `asset_comments`, `shares` |
| Copy | `copy_documents`, `copy_document_versions` |
| Messaging | `conversations`, `conversation_members`, `messages`, `message_reactions` |
| Notifications | `notifications`, `push_subscriptions`, `email_events` |
| Money | `invoices`, `invoice_line_items`, `invoice_sends`, `business_settings`, `pricing_items` |
| CRM | `crm_organisations`, `crm_contacts`, `crm_touches`, `crm_notes`, `crm_tasks`, `crm_research`, `crm_grants`, `crm_lists`, `crm_settings`, `crm_engagements`, `crm_opportunities` |
| Work | `work_items`, `work_item_steps`, `work_item_recurrences` |
| Previews | `client_previews` |
| Legacy | `board_cards` (migrated into work items by 0044, deliberately not dropped) |

### The CRM prospect data is not a migration

It imports in-app, from `src/lib/crm-pipeline-v2.ts`, via "Load v4 pipeline" on
`/admin/crm`. 30 KB of string literals proved unreliable to paste into the
Supabase SQL editor. That file is generated by `scripts/gen-pipeline.py` from
`portal-handoff-pipeline.md` and must never be hand-edited.

---

## 14. Directory tree of `src`

```
src/
├── middleware.ts                       Clerk gate; the public-route list
│
├── app/
│   ├── layout.tsx                      Root layout: ClerkProvider, 4 fonts, THEME_SCRIPT, manifest
│   ├── page.tsx                        Role router; "account is being set up" fallback
│   ├── globals.css                     All design tokens, @theme inline, doc-light, brand-ironpeak, @media print
│   │
│   ├── sign-in/[[...sign-in]]/page.tsx Clerk prebuilt sign-in. No sign-up route exists.
│   │
│   ├── (client)/                       Route group: no URL prefix
│   │   ├── layout.tsx                  Client guard + soft-delete wall + hasPreview lookup
│   │   ├── dashboard/page.tsx          Metrics dashboard
│   │   ├── reports/page.tsx            Published reports only
│   │   ├── reports/[reportId]/page.tsx Report viewer (ReportViewerChrome)
│   │   ├── assets/page.tsx             Folder browser, ?folder=
│   │   ├── copy/page.tsx               Copy document list
│   │   ├── copy/[docId]/page.tsx       Copy editor
│   │   ├── website/page.tsx            Iframe site previews
│   │   ├── messages/page.tsx           Threads the user belongs to; hosts PushToggle
│   │   ├── invoices/page.tsx           Non-draft invoices
│   │   └── invoices/[invoiceId]/page.tsx  Invoice document + print button
│   │
│   ├── admin/
│   │   ├── layout.tsx                  Admin guard
│   │   ├── page.tsx                    The dashboard, on work items. force-dynamic.
│   │   ├── clients/page.tsx            Client list
│   │   ├── clients/actions.ts          Provisioning. Service role after requireAdmin.
│   │   ├── clients/[clientId]/preview/page.tsx   See a client's dashboard as they do
│   │   ├── reports/page.tsx            Report library
│   │   ├── reports/new/page.tsx        Create a report
│   │   ├── reports/actions.ts          save/send/publish/import/upload. RLS client.
│   │   ├── reports/[reportId]/page.tsx The editor
│   │   ├── reports/[reportId]/preview/page.tsx   Print-ready preview; shares the client title
│   │   ├── assets/page.tsx             All clients' assets
│   │   ├── copy/page.tsx               Copy across clients
│   │   ├── copy/[docId]/page.tsx       Copy editor
│   │   ├── messages/page.tsx           Every thread
│   │   ├── messages/actions.ts         Thread creation. Service role after requireAdmin.
│   │   ├── invoices/page.tsx           Invoice library
│   │   ├── invoices/new/page.tsx       Create an invoice
│   │   ├── invoices/actions.ts         save/send/resend/void/test/PDF. RLS client.
│   │   ├── invoices/[invoiceId]/page.tsx    The builder
│   │   ├── invoices/[invoiceId]/error.tsx   Route error boundary
│   │   ├── crm/page.tsx                Prospect board, ?brand=
│   │   ├── crm/actions.ts              All 20 CRM actions incl. replacePipeline, autoSchedule
│   │   ├── crm/plan/page.tsx           The run sheet
│   │   ├── crm/[orgId]/page.tsx        One prospect
│   │   ├── work/actions.ts             complete/snooze/drop/steps/hours/recurrences
│   │   ├── work/recurring/page.tsx     Recurring work definitions
│   │   └── settings/page.tsx           Business settings, pricing, templates
│   │
│   ├── actions/search.ts               searchEverything(), one RLS sweep for Cmd+K
│   │
│   ├── api/
│   │   ├── reports/[reportId]/pdf/route.ts    POST, admin, maxDuration 60
│   │   ├── invoices/[invoiceId]/pdf/route.ts  POST, admin, maxDuration 60
│   │   ├── webhooks/resend/route.ts           Svix-verified delivery events
│   │   └── cron/
│   │       ├── email/route.ts          Daily 07:00 UTC. Emails pending 'instant' notifications.
│   │       ├── digest/route.ts         Mon 08:00 UTC. Batches 'digest' notifications.
│   │       ├── overdue/route.ts        Daily 08:00 UTC. Due-soon + overdue. No attachments.
│   │       ├── recurring/route.ts      Daily 06:00 UTC. Materialise + auto-send. Renders.
│   │       ├── purge-clients/route.ts  Daily 04:00 UTC. 30-day grace hard purge.
│   │       ├── crm-reminders/route.ts  Daily 22:00 UTC. Re-verify tasks only.
│   │       ├── brief/route.ts          Daily 21:00 UTC (7am Brisbane). One notification.
│   │       ├── work/route.ts           Hourly, external. Generators + recurrences + nudges.
│   │       └── crm-send/route.ts       Every few minutes, external. Drafts into Outlook.
│   │
│   ├── print/
│   │   ├── report/[reportId]/page.tsx  Public + HMAC token. Service role. ForcePrintLight.
│   │   └── invoice/[invoiceId]/page.tsx Same, for invoices.
│   │
│   ├── share/
│   │   ├── [token]/page.tsx            Share landing page. Login required.
│   │   └── [token]/raw/route.ts        Revalidates, 302 to a 60s signed URL.
│   │
│   └── unsubscribe/[token]/page.tsx    Public opt-out. Acts on GET. Ironpeak-only branding.
│
├── components/
│   ├── nav/
│   │   ├── Shell.tsx                   Sidebar, header, mobile drawer, palette mount, theme toggle
│   │   └── CommandPalette.tsx          Cmd+K. Nav with no query, searchEverything when typing.
│   ├── brand/
│   │   ├── Wordmark.tsx                Hartwell Pulse wordmark
│   │   └── IronpeakMark.tsx            Ironpeak wordmark. Never shown beside the Hartwell one.
│   ├── ui/                             Badge, Button, Card, DeliveryDot, EmptyState, Lightbox,
│   │                                   PageHeader, SectionLabel, ThemeToggle (+THEME_SCRIPT),
│   │                                   WelcomeFlash, ZoomableImage
│   ├── documents/DocumentPdf.tsx       The PDF card. One component for reports and invoices.
│   ├── reports/
│   │   ├── ReportEditor.tsx            The editor. Owns the live-preview toggle (localStorage).
│   │   ├── ReportViewerChrome.tsx      Viewer + section nav + search. What the renderer photographs.
│   │   ├── ReportDocument.tsx          The document body
│   │   ├── ReportText.tsx              The closed Markdown subset. NOT a library. Nothing can inject markup.
│   │   ├── ReportBlocks.tsx            stats / bar / compare / note fenced blocks
│   │   ├── ReportMetricBlock.tsx       A metric with optional chart
│   │   ├── ReportLetterhead.tsx        Letterhead + colophon. Renders on screen AND in print.
│   │   ├── SectionCard.tsx             One editor section
│   │   ├── BrandSwitch.tsx             hartwell / ironpeak toggle
│   │   ├── ImportReport.tsx            Markdown import
│   │   ├── NewReportForm.tsx           Creation form
│   │   └── ForcePrintLight.tsx         Inline palette override for anything destined to be a PDF
│   ├── invoices/                       InvoiceBuilder, InvoiceDocument, InvoicesLibrary,
│   │                                   NewInvoiceForm, RecipientPicker, ScheduledInvoices,
│   │                                   SendHistory, LastSent, PrintButton
│   ├── assets/                         AssetsBrowser, AssetUploader, AssetViewer, AssetComments
│   ├── copy/                           CopyDocList, CopyEditor (Tiptap), NewCopyButton
│   ├── messages/                       AdminMessages, ClientMessages, ChatThread, EmojiPicker,
│   │                                   UnreadMessagesBadge
│   ├── notifications/                  NotificationBell, PushToggle, TabUnreadBadge
│   ├── dashboard/                      DashboardView, StatCard, MetricChart, DeltaBadge, ServiceSection
│   ├── work/                           WorkDashboard, WorkViews, TodayList, DoneList, WorkItemRow,
│   │                                   WorkStrip, NewWorkForm, Recurrences
│   ├── crm/                            PipelineView, ProspectTable, ProspectDetail, OutreachComposer,
│   │                                   SendPlan, ScheduleTable, AutoSchedule, Reschedule,
│   │                                   ReplacePipeline, ListSwitcher, ContactActions, CrmHealth, GoalRing
│   ├── preview/SitePreview.tsx         Iframe previews at desktop/tablet/mobile widths
│   └── admin/                          NewClientForm, EditClientForm, ClientActions,
│                                       ClientUsersDialog, ClientPreviewsDialog, SettingsManager,
│                                       ProjectBoard, ProjectCalendar
│
└── lib/                                See section 6 for what each file owns
    ├── auth/session.ts
    ├── supabase/{client,server,admin}.ts
    ├── types/database.ts
    ├── utils/cn.ts
    ├── actions/{push,shares}.ts
    ├── brand.ts  nav.ts  celebrate.ts  cron-auth.ts
    ├── invoices.ts  invoices-shared.ts  invoices-send.ts
    ├── reports.ts   reports-shared.ts   reports-send.ts  recipients.ts
    ├── pdf-render.ts  report-pdf.ts  invoice-pdf.ts  print-token.ts  pdf-client.ts
    ├── email.ts  email-delivery.ts  svix-verify.ts  push.ts
    ├── assets.ts  assets-shared.ts  folders.ts  shares.ts
    ├── dashboard.ts  metrics.ts  board-shared.ts
    ├── work.ts  work-shared.ts  work-generate.ts  work-recurrence.ts  work-nudge.ts
    └── crm.ts  crm-shared.ts  crm-send.ts  crm-presend.ts  crm-unresolved.ts
        crm-pipeline-v2.ts (generated)  graph.ts
```

---

## 15. Invariants

Things a future change must never break. Each one has a real incident or a real
constraint behind it.

### Tenancy and access

1. **RLS is the tenancy boundary.** Never move an access decision from a policy
   into application code, and never add a policy that widens a client's reach
   beyond `client_id = current_client_id()`.
2. **`is_admin()` and `current_client_id()` stay `SECURITY DEFINER` with
   `search_path = public`.** Without that they recurse against
   `client_users`' own RLS.
3. **Service role only after an explicit access check.** Every
   `createAdminSupabase()` call site must have already established who the
   caller is and that they are allowed. There are no exceptions in the tree
   today; do not create the first one.
4. **The service key never reaches the browser.** `supabase/admin.ts` and
   `supabase/server.ts` keep `import "server-only"`.
5. **client_id stays the first path segment of every storage object key.**
   Storage RLS reads `(storage.foldername(name))[1]`. Change the key shape and
   you silently open or close the bucket.
6. **New cascade paths need a `BEFORE DELETE` trigger.** FK cascades do not
   re-check RLS. Pattern: `supabase/migrations/0011_permissions.sql`.
7. **Public routes stay path-anchored** in `src/middleware.ts` (note the
   trailing slashes) and each keeps its own check: signature, `CRON_SECRET`, or
   print token.
8. **Never expose a raw signed URL in HTML or email.** Share links go through
   `/share/[token]/raw`, which revalidates the token and 302s to a fresh 60
   second URL.

### The PDF pipeline

9. **Nothing renders inside a server action.** Rendering happens in route
   handlers with `runtime = "nodejs"` and `maxDuration = 60`.
10. **One renderer.** `renderAndAttach` in `src/lib/pdf-render.ts` is the only
    place Chromium launches. Two copies is two places for the theme seeding,
    the wait condition and the page size to drift.
11. **The print token signs the kind as well as the id.** Both print routes are
    public and that signature is the only thing between them and the world.
12. **`serverExternalPackages` keeps `@sparticuz/chromium` and
    `puppeteer-core` out of the bundle**, and `outputFileTracingIncludes` puts
    the binary into the deployment. Both halves are needed. Adding a new render
    route means adding a tracing entry for it.
13. **A print page renders the same component a human sees.** Never a
    print-only twin.
14. **A report send stops on an unreadable attachment; an invoice send never
    does.** Do not "tidy" these into consistency. They are opposite on purpose.
15. **Rendering stays off the report send path.**

### Money

16. **Every write on the money path checks its error.** `saveInvoice` did not,
    and a client was emailed a $0.00 invoice on the wrong terms.
17. **Sent invoices are never hard-deleted.** Void only. Drafts may be deleted.
    Paid and void are locked in `saveInvoice` as well as the UI.
18. **`sent_at` is the first send and never moves.** `last_sent_at` carries
    resends. `revision` bumps only when an already-sent invoice is saved.
19. **Every send writes an `invoice_sends` row**, snapshotting amount, due date,
    revision and the addresses it reached. Snapshotted, not joined: a later
    correction is exactly what would rewrite that history.
20. **Recipients resolve through `resolveRecipients()` only.** Empty
    `recipient_user_ids` means everyone on the account; an empty *result* means
    stop, never fall back to everyone. A fourth caller doing its own
    `client_users` query is how these drift apart.

### Documents and brand

21. **A document must never hardcode a colour.** Read `--pulse-gold`.
22. **Client-facing Ironpeak output never mentions Hartwell Digital.** The bare
    ABN line is the only permitted expression of the parent.
23. **Ironpeak identity lives once, in `src/lib/brand.ts`.** Never re-declare it
    in a component.
24. **Ironpeak figures go in Geist Mono**, never Clash Display, which has no
    tabular figures.
25. **`ReportText.tsx` stays a closed Markdown subset**, not a library. Nothing
    in a report body may inject markup.

### Theming

26. **`THEME_SCRIPT` runs before first paint.** Move it out of `<head>` and
    every load flashes.
27. **`prefers-color-scheme` is not read.** Dark is the default; light is a
    choice made in the portal.
28. **`gold-light` means "more prominent on hover", not "lighter".** In light
    mode it is darker.
29. **`color-scheme` is set explicitly wherever a light document is printed.**
    It paints the page canvas, which no background property reaches.
30. **The `@media print` token block keeps all three root selectors**, and
    `ForcePrintLight` keeps the same values as that block.

### Notifications and outreach

31. **`recordEmail` swallows its own failures.** Telemetry must never stop an
    invoice.
32. **Email status only moves forward through `RANK`.**
33. **The service worker stays push-only.** No offline cache.
34. **The portal does not send Ironpeak outreach.** It drafts into Outlook and
    Kyle presses send. Do not restore a send path (`graphSendMail` was deleted
    rather than left unused) until the tenant block is resolved *and* the
    sending arrangement has changed.
35. **A draft is not a send.** `crm_touches` is written by `confirmSent`, never
    at draft time. Logging at draft time would fill the Spam Act record with
    messages that never left.
36. **The nine pre-send checks live once**, in `src/lib/crm-presend.ts`.
37. **`crm-pipeline-v2.ts` is generated.** Change the markdown and run
    `scripts/gen-pipeline.py`.

### Work items

38. **The partial unique index
    `(source_kind, source_key) where state = 'open'` is the whole design.** It
    is what lets the generator run hourly without becoming the notification
    problem in a nicer font. The key carries a stage, not just a row id.
39. **A tick may never fabricate a record with legal or financial weight.**
    `completeWork` refuses `crm_send` and `invoice` and says where to go
    instead.
40. **One notification a day for Kyle's own work**, from `/api/cron/brief`, and
    silent when nothing is due.

### Platform

41. **Never put `next/image` in front of a Supabase signed URL.**
42. **Vercel crons stay daily.** Anything sub-daily goes on cron-job.org with
    the `CRON_SECRET` bearer token.
43. **Migrations are idempotent** and are applied by hand. Probe for applied
    state, never assume.

---

## Open questions

Things that could not be resolved from the code and the repo alone.

1. **Is `/api/cron/work` actually scheduled?** `docs/dashboard-spec.md:315-318`
   says "The hourly cron **needs setting up** on cron-job.org". It is not in
   `vercel.json`. Whether that job exists on cron-job.org today cannot be
   determined from the repo. If it does not, work items are only generated when
   `/api/cron/brief` runs at 21:00 UTC, which calls `generateWorkItems` and
   `materialiseRecurrences` but **not** `nudgeTimedItems`. That would mean the
   timed nudges never fire at all.

2. **Is `/api/cron/crm-send` currently disabled at cron-job.org?** CLAUDE.md is
   emphatic that scheduled sending must not resume until the Microsoft 365
   tenant block is resolved and the sending arrangement has changed. The route
   still exists and still works. Whether the external schedule was actually
   turned off is not visible from here. Worth confirming before anything else in
   the CRM is touched.

3. **Has an invoice PDF ever rendered successfully in production?** See risk 1
   below. If it has, the tracing analysis is wrong somewhere and it would be
   worth knowing why.

4. **What are the Resend webhook events configured as?** The handler maps eight
   event types. Whether all eight are subscribed in the Resend dashboard cannot
   be checked from the repo, and an unsubscribed `email.bounced` would mean the
   delivery dots silently never leave grey.

5. **VAPID keys in Vercel.** `pushConfigured()` reads
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Neither appears in
   `.env.local.example`, so whether push is live in production is unknown from
   here.

6. **`board_cards` retirement.** 0044 migrated its rows into work items and
   deliberately did not drop the table. `src/lib/board-shared.ts`,
   `ProjectBoard.tsx` and `ProjectCalendar.tsx` still exist. Whether they are
   still reachable from any route was not traced; `adminNav` has no board entry.

7. **`CLERK_WEBHOOK_SIGNING_SECRET`** is in `.env.local.example` but no code
   reads it and there is no `/api/webhooks/clerk` route. Either a Clerk webhook
   was planned and dropped, or it was removed and the example file was not
   updated.

---

## Risks and gaps

Ordered by how much damage each could do.

### 1. The invoice PDF route is probably missing its Chromium binary (high)

`next.config.mjs` traces `@sparticuz/chromium` into two routes:

```js
"/api/reports/[reportId]/pdf": [...],
"/api/reports/**":             [...],
```

Neither pattern matches **`/api/invoices/[invoiceId]/pdf`** or
**`/api/cron/recurring`**, and both of those launch Chromium. By the config
file's own stated reasoning ("Nothing imports the binary, it is read off disk at
runtime, so Next's file tracer has no reason to copy it into the deployed
function and does not"), those two functions would start fine and then fail at
`chromium.executablePath()` with a path that does not exist.

The failure is quiet by design: `renderAndAttach` catches it and returns
`{ok:false, message}`, `InvoiceBuilder` deliberately ignores the result, and the
recurring cron only `console.warn`s. So an invoice would send with a link and
nobody would be told the attachment was never made.

**Unverified against a live render.** The dynamic `import("@sparticuz/chromium")`
in `pdf-render.ts` is a real code reference, so the package's *JavaScript* is
almost certainly traced; the problem is the `bin/` payload, which is data. The
fix, if it is broken, is one line each:

```js
"/api/invoices/[invoiceId]/pdf": ["./node_modules/@sparticuz/chromium/**/*"],
"/api/cron/recurring":           ["./node_modules/@sparticuz/chromium/**/*"],
```

**Check this first.** Press "Make the PDF" on an invoice in production and read
the message.

### 2. The morning brief's email lands nine hours after the brief (medium)

`/api/cron/brief` runs at 21:00 UTC, which is 07:00 Brisbane, and inserts
notification rows with `channel: "instant"` and no `emailed_at`. Nothing pushes
them: `pushToUsers` is only called by `notifyNewMessage` and `sendTestPush`.
The rows are emailed by `/api/cron/email`, which runs at 07:00 UTC, or 17:00
Brisbane.

So the morning brief appears in the notification bell at 7am and arrives by
email at 5pm the same day. The same applies to `work-nudge`'s "Now: {title}"
messages, which are meant to announce an 08:47 send and would email at 5pm.

If the brief is intended to be read in the bell, this is fine and should be
written down. If it was meant to be an email or a push, it is not doing that.

### 3. Reminder emails carry no PDF (medium, known)

Confirmed by reading `src/app/api/cron/overdue/route.ts`: neither the due-soon
heads-up nor the overdue nudge passes `attachments` to `sendEmail`. Both send
HTML plus a portal link.

That is the exact problem the send-path attachment (0042, 0043) was added to
fix: a client handed a portal link has a sign-in between them and the thing they
were promised, and whoever they forward it to has no login at all. On an overdue
chase that reaches a bookkeeper, it is the same gap on the same invoice.

The invoice already has `pdf_path` and `pdf_name` by the time a reminder fires,
so the fix is to lift the download-and-base64 block out of `invoices-send.ts`
into a shared helper and use it in both reminders. Note it would also want the
invoice-side failure semantics: a reminder must never fail to arrive because a
file could not be read.

### 4. `.env.local.example` is missing seven live variables (medium)

Referenced in code but absent from the example file:

```
RESEND_WEBHOOK_SECRET
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
MS_GRAPH_TENANT_ID
MS_GRAPH_CLIENT_ID
MS_GRAPH_CLIENT_SECRET
IRONPEAK_SEND_FROM
```

And `CLERK_WEBHOOK_SIGNING_SECRET` is listed but read by nothing. Every one of
the missing variables silently disables a feature when unset rather than
failing loudly, which makes the example file the only reasonable inventory. It
should be complete.

### 5. CLAUDE.md's search-action claim is stale (low, but it is a security note)

CLAUDE.md says `searchEverything()` is "a flat sweep with NO role branching on
purpose". `src/app/actions/search.ts` branches on `isAdmin` to skip the
`clients` and `crm_organisations` queries and to choose hrefs. The safety
property still holds because RLS is doing the work, but the file's own
description of itself is now wrong, and a future reader who trusts the note
would look for a branch that is there and conclude something is broken.

### 6. `documentNames` can produce a name-only or extension-only file (low)

`documentNames("...", fallback)` strips characters and can reduce a title to an
empty string, in which case it falls back. That part is handled. What is not:
`renderInvoicePdf` builds `rawName` as
`` `${business_name} Invoice ${invoice_number ?? ""}` ``, so an invoice with a
null `invoice_number` produces a trailing space that `.trim()` catches, but a
client whose `business_name` is entirely non-ASCII produces a `keyName` of just
`"invoice"` for every one of their invoices. The `Date.now()` prefix on the
storage path keeps that from colliding, so this is cosmetic rather than
dangerous. Noted so it is not rediscovered as a bug.

### 7. `src/lib/types/database.ts` is hand-maintained and already incomplete (low)

It has no `ClientPreview` interface, even though `client_previews` has existed
since migration 0041. `src/components/preview/SitePreview.tsx` declares its own
`PreviewItem` type instead, and `src/app/(client)/website/page.tsx` casts to it.
Work-item types live in `src/lib/work-shared.ts` rather than in
`database.ts`, which is defensible (they need to be client-safe) but means
there are now two places to look for a row shape. Neither is wrong today. Both
are drift surfaces.

### 8. `ForcePrintLight` duplicates the print block's values by hand (low, known)

The component says so itself: "Same values as the print block, deliberately. If
those ever change, these change with them." There is no test and no shared
constant enforcing it. A mismatch would mean a hand-printed PDF and a generated
one no longer look the same, which is exactly the class of bug this whole
subsystem was built to avoid. A shared CSS custom property set, or a comment
marker in both files, would make the coupling visible.

### 9. `resolveShare` increments `use_count` on the landing page only (low)

`src/app/share/[token]/page.tsx` increments `use_count` once per landing-page
view. `/share/[token]/raw` re-validates the token, which includes the
`use_count >= max_uses` check, but does not increment. So a `max_uses` share
limits how many times the landing page can be opened, not how many times the
file can be fetched. Whether that is the intent is not written down anywhere.
