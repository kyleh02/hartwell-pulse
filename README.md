# Hartwell Pulse

The internal client portal for Hartwell Digital. Clients sign in to see their
monthly reports, upload assets, message Kyle, and check how their campaigns are
going. Kyle gets an admin view across every client.

Built with Next.js (App Router) + Clerk (auth) + Supabase (Postgres + storage),
themed in the dark, gold-accented Pulse style.

---

## Where this build is up to

**Phase 1 — Foundation is done:**

- Next.js + TypeScript + Tailwind v4 with the full Pulse theme (tokens, fonts, textures)
- Clerk auth wired in, with a branded sign-in screen and protected routes
- Supabase clients (browser, server, service-role) that run every query under the signed-in user
- The complete database schema, Row Level Security policies, and storage buckets
- The admin vs client role system
- Responsive app shells: desktop sidebar, mobile drawer, and a client bottom tab bar
- All section screens stubbed with on-brand placeholders, ready to fill in

**Next up (not built yet):** the client dashboard, reports, assets, messaging,
the admin kanban/calendar, and notifications — built phase by phase.

---

## Before you start: a note on Google Drive

This project currently lives in a Google Drive folder. `node_modules` is tens of
thousands of files and Drive will try to sync every one of them, which is slow
and occasionally flaky. Do one of these:

- **Best:** copy this folder to a local disk (e.g. `C:\dev\hartwell-pulse`) for
  day-to-day development, and keep Drive as a backup of the source.
- **Or:** tell Google Drive to stop syncing the `node_modules` folder.

The source code is fine on Drive — it is only `node_modules` that hurts.

---

## Setup

### 0. Install dependencies

```bash
npm install
```

### 1. Clerk (authentication)

1. Create an app at [dashboard.clerk.com](https://dashboard.clerk.com).
2. **Turn off public sign-up.** Clients are created by Kyle, not self-serve.
   In Clerk: *User & Authentication → Restrictions* → set sign-up to
   restricted/invite-only (or disable it).
3. Copy your **Publishable key** and **Secret key** into `.env.local`.
4. **Add the Supabase role claim.** In Clerk: *Sessions → Customize session
   token*, and add:
   ```json
   { "role": "authenticated" }
   ```
   This is what lets Supabase treat Clerk-signed requests as authenticated.

### 2. Supabase (database + storage)

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open the **SQL Editor** and run the migrations in order:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_rls.sql`
   - `supabase/migrations/0003_storage.sql`
3. (Optional) run `supabase/seed.sql` for a demo client and sample metrics.
4. From *Project Settings → API*, copy the **Project URL**, the **anon key**, and
   the **service_role key** into `.env.local`.

### 3. Connect Clerk to Supabase

In the **Supabase** dashboard: *Authentication → Sign In / Providers → Third
Party Auth → Add provider → Clerk*. Paste your Clerk **Frontend API URL** (from
the Clerk dashboard, *API Keys → Show API URLs → Frontend API URL*).

This is the native integration: it tells Supabase to trust JWTs Clerk issues, so
the RLS policies can read the Clerk user id from the token. No JWT template
needed.

### 4. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in the Clerk and Supabase values you collected above. Leave the Resend
values until the notifications phase.

### 5. Make yourself the admin

1. `npm run dev` and sign in once so Clerk creates your user.
2. Grab your Clerk user id (Clerk dashboard → Users → your user → the
   `user_...` id).
3. In the Supabase SQL editor:
   ```sql
   insert into public.client_users (clerk_user_id, role, full_name, email)
   values ('user_YOUR_ID', 'admin', 'Kyle', 'kyle@hartwelldigital.com.au')
   on conflict (clerk_user_id) do update set role = 'admin';
   ```
4. Reload. You will land in the admin view at `/admin`.

### 6. Run it

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm run typecheck
```

---

## How data isolation works

Each client only ever sees their own data, and that is enforced in the database,
not the UI:

- Every client-data table has a `client_id`, and RLS policies only return rows
  where `client_id` matches the signed-in user's client.
- The Clerk user id (the JWT `sub` claim) maps to a row in `client_users`, which
  carries the role and `client_id`.
- Admin (`is_admin()`) reads and writes across all clients.
- `api_connections`, `insight_snippets`, and the `board_cards` kanban are
  admin-only — clients have no policy granting access, so they get nothing.
- Reports are only visible to clients once `status = 'published'`.
- Storage files live under a `<client_id>/...` prefix and are scoped the same way.

The service-role key (`src/lib/supabase/admin.ts`) bypasses RLS and is for
trusted server code only — never import it into a client component.

---

## Project structure

```
src/
  app/
    layout.tsx                 root layout: fonts, ClerkProvider, theme
    page.tsx                   role-based redirect / account-pending screen
    sign-in/                   branded Clerk sign-in
    (client)/                  client area (shared shell)
      dashboard | reports | assets | messages
    admin/                     admin area (Kyle only)
      clients | reports | assets | messages | settings
  components/
    brand/                     wordmark + pulse glyph
    nav/Shell.tsx              responsive sidebar / drawer / bottom tabs
    ui/                        Card, Button, Badge, SectionLabel, EmptyState, ...
    admin/                     admin-specific pieces
  lib/
    supabase/                  browser / server / admin clients
    auth/session.ts            Clerk user -> role + client_id
    types/database.ts          row types, kept in sync with the SQL
    nav.ts                     navigation config
    utils/cn.ts
  middleware.ts                Clerk route protection
supabase/
  migrations/                  0001 schema, 0002 RLS, 0003 storage
  seed.sql                     optional demo data
```

---

## Deploying

Deploy to Vercel. Add the same environment variables in the Vercel project
settings, set `NEXT_PUBLIC_APP_URL` to your real domain, and point the domain
(`hartwellpulse.com.au` or whichever is registered) at it. Add that domain to
Clerk's allowed origins.

---

## Copy and tone

All text in the platform is plain Australian English in Kyle's voice:
conversational, warm, no marketing clichés, no em dashes. Down metrics in client
reports are always reframed constructively, never hidden. See the spec for the
full copy rules.
