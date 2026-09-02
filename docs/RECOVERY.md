# Recovery: 2 September 2026

The SSD in the machine doing the development died. The Claude Code session
history on it went with the drive. This records what survived, how that was
established, and what it means for how the project is worked on from here.

## Outcome

Nothing was lost. Every line of code, every migration and the handoff notes all
survived, in two independent places.

| Check | Result |
| --- | --- |
| Commits recovered from GitHub | 103, bringing the clone to `2dd379a` |
| Files existing only in Google Drive (never pushed) | 0 |
| Migrations confirmed applied in production | all 46 |
| Secrets | partially recovered locally, remainder in Vercel |

## Why it survived

Two habits saved it, and they are worth keeping deliberately.

**Pushing to `main` to deploy.** Vercel builds from GitHub, so every deployment
was also a backup. The 103 commits sitting on `origin/main` were the whole of
the other machine's work.

**Editing inside Google Drive.** The source of truth was a synced folder, not a
local one, so the files existed in Google's cloud independently of the disk.

Either one alone would have been enough. Having both is why the answer was
"nothing lost" rather than "most of it".

## How that was established

1. `git fetch` showed the local clone 103 commits behind `origin/main`. A
   `--ff-only` pull recovered them, which also proved the clone had no local
   commits of its own to conflict.
2. Every file in the Drive folder was hashed against the same file in the
   recovered clone, with carriage returns stripped so line-ending differences
   did not read as changes. Result: 0 files present only in Drive, so nothing
   had been written on the other machine without also being pushed. The only
   differences were `.env.local` (gitignored by design) and a `DEPLOYMENT.md`
   timestamp.
3. The live database was probed for the signature table or column of each
   migration, using the service-role key. 34 probes, none missing.

## Migration state, verified

All migrations 0001 to 0046 are applied in production, confirmed 2 September
2026. This replaced a real unknown: the handoff recorded 0035 to 0041 as
verified on 18 August and everything below as merely assumed, while 0042 to 0046
were written after that check and had never been confirmed at all.

The probe is a zero-row select against the object a migration creates. Read the
error code to tell the two failure modes apart:

- `42P01` or `PGRST205` means the table is absent.
- `42703` or `PGRST204` means the table exists but the column is absent.

Re-run this after any new migration. Applied state is still not tracked
anywhere, so it remains something to check rather than assume.

## Secrets

`.env.local` is gitignored, so it was the one thing git could not restore. The
two surviving copies turned out to be complementary:

| Secret | Old laptop copy (June) | Drive copy (July) |
| --- | --- | --- |
| `CLERK_SECRET_KEY` | set | blank |
| `NEXT_PUBLIC_SUPABASE_URL` | set | blank |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | set | blank |
| `SUPABASE_SERVICE_ROLE_KEY` | set | blank |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | absent | set |
| `VAPID_PRIVATE_KEY` | absent | set |
| `VAPID_SUBJECT` | absent | set |

The June Supabase service-role key still authenticates, which is what made the
migration probe possible.

Still Vercel-only, in neither local file: `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET`, `CRON_SECRET`, and the `MS_GRAPH_*` set. `vercel env
pull` retrieves them.

## What this changes about working on the project

- **The documentation set in `docs/` exists because of this.** Session history
  is not a store of record and will be lost again. Anything that must survive
  belongs in a file that is committed.
- **`CLAUDE.md` is the entry point** and stays authoritative for rules and
  reasoning. The `docs/` files carry the detail underneath it.
- **Keep pushing to deploy, and keep the source in Drive.** The redundancy is
  not incidental, it is the recovery plan.
- **A second machine is set up from `SETUP.md`,** which covers everything except
  the secrets, which must be moved by hand or pulled from Vercel.
