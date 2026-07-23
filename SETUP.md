# Setting up a new machine for Hartwell Pulse

Follow these once per PC. Project knowledge lives in [CLAUDE.md](CLAUDE.md) —
this file is only about getting a machine ready.

## 1. Install
- **Google Drive for desktop** — sign in, and set the drive letter to **H:**
  (Drive icon → Settings → Preferences → Google Drive → drive letter). The
  Claude Code project (and its memory) is keyed to `H:\My Drive\Website Code`,
  so the letter must match.
- **Node.js LTS** — https://nodejs.org
- **Git** — https://git-scm.com/download/win
- **Claude Code** — sign in with the same account.

## 2. Clone the build copy
`npm install` does not work inside Google Drive, so building and pushing happen
from a local clone:

```
git clone https://github.com/kyleh02/hartwell-pulse.git C:\Users\<you>\pulse-verify
npm --prefix C:\Users\<you>\pulse-verify install
```

## 3. Secrets
Copy `.env.local` from an existing machine into the new clone's root. It is
gitignored on purpose (Supabase service-role key, Clerk, Resend, CRON_SECRET) —
move it privately (USB), never by email or a public channel.

## 4. Claude Code memory (optional but recommended)
To carry Claude's accumulated project memory across, copy this folder from the
old PC to the same path on the new one (swap the username):

```
C:\Users\<old-you>\.claude\projects\H--My-Drive-Website-Code\
```

Copying just `memory\` brings the knowledge; copying the whole folder also
brings past session transcripts (`claude --resume`).

## 5. Verify
From a terminal:

```
npm --prefix C:\Users\<you>\pulse-verify run build
git -C C:\Users\<you>\pulse-verify fetch
```

Both should succeed. Pushing to `main` deploys to Vercel, so only push
deliberately.

## Day-to-day workflow (recap)
1. Edit the source of truth: `H:\My Drive\Website Code\hartwell-pulse`.
2. Sync to the clone: `robocopy "H:\My Drive\Website Code\hartwell-pulse\src" "C:\Users\<you>\pulse-verify\src" /E` (and `supabase` likewise — never `/MIR`).
3. Build in the clone: `npm --prefix C:\Users\<you>\pulse-verify run build`.
4. Commit + push from the clone. Vercel deploys `main` automatically.
5. New SQL migrations are pasted into the Supabase SQL Editor manually.

## First Claude Code session on a new machine
Open Claude Code in `H:\My Drive\Website Code` and paste:

```
I've just moved to this new PC. This is my Hartwell Pulse project (the client
portal). Get this machine fully set up and verified:

1. Read hartwell-pulse/CLAUDE.md and hartwell-pulse/SETUP.md first — they
   explain the project and the dual-copy workflow.
2. Check prerequisites: git and node installed, and this folder is Google Drive
   mounted as H:.
3. If the local build clone doesn't exist yet, clone
   https://github.com/kyleh02/hartwell-pulse.git to <my user folder>\pulse-verify
   and run npm install there (never inside this Drive folder).
4. Check the clone has .env.local — if missing, stop and tell me to copy it from
   my old PC (it's gitignored and holds the secrets).
5. Run a production build in the clone and confirm it passes.
6. Confirm git can reach origin (fetch + status).
7. If my Claude memory folder from the old PC hasn't been copied here yet
   (\.claude\projects\H--My-Drive-Website-Code\), remind me.
8. Report what you checked, what you fixed, and anything still missing.

Don't push or deploy anything — set up and verify only.
```
