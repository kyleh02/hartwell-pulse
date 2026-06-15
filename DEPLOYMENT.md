# Deploying Hartwell Pulse

A step-by-step guide to taking Pulse live on Vercel. Work top to bottom. You'll
touch five services: GitHub (code), Vercel (hosting), Clerk (auth), Supabase
(database, you already have this), and Resend (email).

The app is a git repo on your local disk at `C:\Users\kylea\pulse-verify`, with
secrets (`.env.local`) already excluded from git.

---

## Do you need to buy a domain?

No. You can launch on a free `*.vercel.app` URL. For a proper production setup
the recommended option is a **free subdomain of a domain you already own**, e.g.
`pulse.hartwelldigital.com`. A custom domain matters mainly because Clerk's
production keys need DNS records on a domain you control. Email verifies
`hartwelldigital.com`, which you already own.

---

## Step 1 — Put the code on GitHub

1. Create a new **private** repo at github.com/new (e.g. `hartwell-pulse`). Don't
   add a README/gitignore (the repo already has them).
2. In a terminal at `C:\Users\kylea\pulse-verify`:
   ```bash
   git remote add origin https://github.com/<your-username>/hartwell-pulse.git
   git push -u origin main
   ```

## Step 2 — Deploy on Vercel

1. Sign in at vercel.com with GitHub. **Add New → Project** → import the repo.
2. Framework is auto-detected (Next.js). Don't deploy yet — add the environment
   variables first (Step 7), or deploy once and add them after (it'll rebuild).
3. Deploy. You get a `*.vercel.app` URL straight away.

## Step 3 — Custom domain (recommended)

1. In your DNS provider for `hartwelldigital.com`, you'll add records Vercel
   gives you. In Vercel: **Project → Settings → Domains → Add** →
   `pulse.hartwelldigital.com`.
2. Vercel shows a **CNAME** record (usually `cname.vercel-dns.com`). Add it at
   your DNS host for the `pulse` subdomain. It verifies in a few minutes.
3. Set `NEXT_PUBLIC_APP_URL` to `https://pulse.hartwelldigital.com`.

## Step 4 — Clerk production instance

Your current Clerk app is in **development**. Create a production instance:

1. Clerk dashboard → your app → switch to **Production** (top of the page) →
   create it.
2. Set the application domain to your portal domain
   (`pulse.hartwelldigital.com`).
3. Clerk gives you **DNS records** (CNAMEs like `clerk.pulse...`,
   `accounts.pulse...`). Add them at your DNS host. They verify in minutes.
4. Redo the two settings on the **production** instance (they're per-instance):
   - **Sessions → Customize session token** → add `{ "role": "authenticated" }`.
   - **Restrictions** → sign-up Restricted.
   - (Client Trust: the app already pins a compatible Clerk.js, so it just
     works. Leave it on or turn it off under Updates — your call.)
5. Copy the **production** keys: `pk_live_...` and `sk_live_...` (for Vercel env).
6. Copy the production **Frontend API URL** (API keys → Show API URLs) for the
   next step.

## Step 5 — Supabase

You can reuse your existing Supabase project for production (it already has the
schema and your data). One change:

1. Supabase → **Authentication → Third-Party Auth** → add the **production**
   Clerk Frontend API URL (from Step 4) alongside the dev one.
2. Make sure every migration has been run: `0001`–`0006`. (If you started a
   fresh prod project instead, run `supabase/setup_all.sql` then `0004`, `0005`,
   `0006`, then the seeds.)

## Step 6 — Resend (email)

1. Create an account at resend.com.
2. **Domains → Add domain** → `hartwelldigital.com`. Add the DNS records it
   gives you (SPF/DKIM). Verify.
3. Create an **API key**. That's `RESEND_API_KEY`.
4. Set `EMAIL_FROM` to something on that domain, e.g.
   `Kyle at Hartwell Digital <kyle@hartwelldigital.com>`.

## Step 7 — Environment variables (in Vercel)

Project → **Settings → Environment Variables**. Add these for **Production**:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...` (Step 4) |
| `CLERK_SECRET_KEY` | `sk_live_...` (Step 4) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL` | `/sign-in` |
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (secret) |
| `RESEND_API_KEY` | `re_...` (Step 6) |
| `EMAIL_FROM` | `Kyle at Hartwell Digital <kyle@hartwelldigital.com>` |
| `CRON_SECRET` | any long random string (protects the cron routes) |
| `NEXT_PUBLIC_APP_URL` | `https://pulse.hartwelldigital.com` |

After adding them, **redeploy** (Deployments → ⋯ → Redeploy).

## Step 8 — Final data + settings

1. In the live app, sign in (your admin Clerk user must be mapped in
   `client_users` — same as dev; if it's a new prod Clerk user, add the mapping
   row with that user's id).
2. **Settings**: business details, bank account, prices.
3. Run the demo seeds only if you want sample data; skip for a clean launch.

## Step 9 — Cron jobs

The cron schedules live in `vercel.json` and run automatically on Vercel once
`CRON_SECRET` is set (Vercel sends it as a Bearer token):
- `/api/cron/email` — every 2 min (instant emails)
- `/api/cron/digest` — Monday 8am (weekly digest)
- `/api/cron/overdue` — daily 8am (overdue reminders)
- `/api/cron/recurring` — 1st of month 7am (recurring invoices)

Note: minute-level crons may need a Vercel **Pro** plan; on Hobby you can run
them less often or trigger via an external free cron (e.g. cron-job.org) hitting
the URL with the `Authorization: Bearer <CRON_SECRET>` header.

---

## Go-live checklist

- [ ] Code pushed to GitHub, Vercel project deploys green
- [ ] `pulse.hartwelldigital.com` resolves and loads
- [ ] Clerk production: DNS verified, role claim + restricted sign-up set
- [ ] Supabase: production Clerk domain added to Third-Party Auth, migrations 1–6 run
- [ ] Resend: domain verified, key set
- [ ] All env vars set in Vercel, redeployed
- [ ] Sign in works; admin lands on `/admin`
- [ ] Settings filled (ABN, bank, prices)
- [ ] Send a test invoice to yourself and confirm the email arrives
