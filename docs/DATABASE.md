# Hartwell Pulse: database reference

Postgres on Supabase. 46 migrations in `supabase/migrations/`, 42 tables, 2 private
storage buckets, one sequence, no views. Row Level Security is the tenancy
boundary, not a second line of defence behind application checks.

This file is the schema reference. `CLAUDE.md` at the repo root carries the rules
and the incident history and stays the entry point; `docs/RECOVERY.md` records
how the applied state below was established.

---

## 1. Applied state: all 46 confirmed, 2 September 2026

**Migrations 0001 to 0046 are all applied in production.** Confirmed 2 September
2026 by probing the live database for the signature table or column of each
migration: 34 probes, 0 missing.

This supersedes `CLAUDE.md`'s older position, which recorded 0035 to 0041 as
verified on 18 August 2026 and everything below 0035 as merely assumed on the
strength of features working. 0042 to 0046 were written after that check and had
never been confirmed at all. They have been now. Treat the whole range as
applied.

Applied state is still **not tracked anywhere in the database**. There is no
`schema_migrations` table, because migrations are not run by a tool: Kyle pastes
each one into the Supabase SQL Editor by hand. So the only honest answer to "is
0047 applied" is to go and look.

### The probe technique

Attempt a zero-row select against the object the migration creates, using the
service-role key, and read the error code:

| Result | Meaning |
| --- | --- |
| No error | The object exists. The migration ran. |
| `42P01` or `PGRST205` | The table is absent. The migration did not run. |
| `42703` or `PGRST204` | The table exists but the column is absent. A column-adding migration did not run. |

For a table-creating migration probe the table; for a column-adding one probe the
column. Two shapes, using the service-role client:

```js
// table probe (0044): does work_items exist?
await admin.from("work_items").select("id").limit(0);

// column probe (0046): does work_items.nudged_at exist?
await admin.from("work_items").select("nudged_at").limit(0);
```

`.limit(0)` matters: it asks Postgres to resolve the name without reading any
rows, so the probe is free and cannot be confused by an empty table. A function
is probed by calling it (`admin.rpc("crm_activity_days", { p_days: 1 })`); a
trigger has no REST surface and needs a SQL query against `pg_trigger`.

Re-run the relevant probes after every new migration and record the date here.

### Writing a migration

They are pasted by hand, sometimes twice, sometimes half a file at a time when
the editor times out. So every migration must be re-runnable:

- `add column if not exists`, `create table if not exists`, `create index if not exists`
- `drop policy if exists` before `create policy` (Postgres has no `create policy if not exists`)
- `drop trigger if exists` before `create trigger`
- `alter table ... drop constraint if exists` before adding a check constraint
- guarded `do $$ ... $$` blocks for anything else, e.g. adding a table to the realtime publication (`exception when duplicate_object then null`)
- **tables first, then functions.** plpgsql resolves `%ROWTYPE` in a `DECLARE`
  block at compile time, so a trigger function referencing a table defined later
  in the same file fails to create. 0022 is organised around this.

The CRM prospect data is deliberately **not** a migration. It imports in-app from
`src/lib/crm-pipeline-v2.ts` via "Load v4 pipeline" on `/admin/crm`, because 30 KB
of string literals proved unreliable to paste into the SQL editor.

---

## 2. The RLS model

### 2.1 The three helpers

Defined in `0002_rls.sql`. Everything else leans on them.

| Function | Returns | Notes |
| --- | --- | --- |
| `clerk_user_id()` | `text` | `auth.jwt() ->> 'sub'`. Plain `stable sql`, no SECURITY DEFINER: it reads the JWT, not a table. Returns NULL under the service role, which is how guard triggers detect trusted server code. |
| `is_admin()` | `boolean` | Exists-check against `client_users` for `role = 'admin'`. |
| `current_client_id()` | `uuid` | The caller's `client_users.client_id`. NULL for an admin. |

`is_admin()` and `current_client_id()` are `security definer` **because they read
`client_users`, which itself has RLS**. Without SECURITY DEFINER the policy on
`client_users` would call `is_admin()`, which would query `client_users`, which
would evaluate the policy: infinite recursion. Both also carry
`set search_path = public` so a caller cannot shadow `client_users` with
something of their own. Every SECURITY DEFINER function in this schema follows
that pair of rules. Do not add one that does not.

The Supabase to Clerk native integration puts the Clerk user id in the JWT `sub`
claim and gives the request the Postgres role `authenticated`. `anon` gets
nothing. `service_role` bypasses RLS entirely, which is why
`createAdminSupabase()` is only used in trusted server code and only after an
explicit role check.

### 2.2 The standard policy pair

Almost every client-facing table carries two policies:

```sql
create policy X_admin_all on public.X
  for all to authenticated using (is_admin()) with check (is_admin());
create policy X_client_read on public.X
  for select to authenticated using (client_id = current_client_id());
```

Permissive policies are OR-ed, so the admin policy is a clean override. Tables
where a client may also write get narrow extra policies that pin the writer's own
identity into the `with check` (`uploaded_by = clerk_user_id()`,
`sender_role = 'client'`), so a client cannot insert a row attributed to Kyle.

Three tables are admin-only with no client policy at all: `api_connections`
(holds credentials), `insight_snippets` (Kyle's private library), `board_cards`.
The whole `crm_*` family and the whole `work_*` family are admin-only too.
`push_subscriptions` goes further and has **RLS enabled with zero policies plus
`revoke all from anon, authenticated`**: push keys are effectively send
credentials, so every read and write goes through the service role.

### 2.3 Restrictive policies (0011)

Permissive policies grant. To take something away you need
`as restrictive`, which is AND-ed with everything else. 0011 uses this for the
view-only folder feature:

```sql
create policy assets_restrict_update on public.assets
  as restrictive for update to authenticated
  using (is_admin() or (not locked and folder_editable(folder_id)))
  with check (is_admin() or (not locked and folder_editable(folder_id)));
```

Three points of design worth keeping:

1. **SELECT is deliberately untouched.** A view-only folder stays fully readable
   by the client. Only writes are gated. Making a folder read-only should not
   make it invisible.
2. **`is_admin() or ...` appears inside every restrictive policy.** A restrictive
   policy applies to everyone including the admin, so the admin escape has to be
   written into the restriction itself. Forgetting it locks Kyle out of his own
   data.
3. `folder_editable(uuid)` returns `true` for a NULL folder id, so the root is
   editable and an asset with no folder is not accidentally frozen.

`messages_restrict_select` (0017, rewritten by 0018) is the other restrictive
policy: it hides messages of a soft-deleted conversation from **both** sides,
which a permissive policy cannot express.

### 2.4 The cascade trap, and the BEFORE DELETE workaround

**Postgres FK cascades do not re-check RLS.** A cascade runs as an internal
system operation; the policies on the child table are simply not consulted. This
is the single most dangerous thing about the schema and the reason two triggers
exist.

The live case is 0011. `asset_folders.parent_id` is `on delete cascade` and
`assets.folder_id` is `on delete set null`. A client deleting an editable parent
folder would therefore cascade straight through an admin's nested view-only
sub-folder, and would silently free every locked asset inside it by nulling
`folder_id`. The RESTRICTIVE policy cannot stop it, because the policy is never
evaluated.

A **BEFORE DELETE row trigger does fire on cascade-deleted rows**, so that is the
workaround:

```sql
create or replace function public.asset_folders_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.clerk_user_id() is null or public.is_admin() then
    return old;                       -- service role and admin pass
  end if;
  if not old.client_editable then
    raise exception 'cannot delete a view-only folder';
  end if;
  if exists (select 1 from public.assets where folder_id = old.id and locked) then
    raise exception 'cannot delete a folder that contains a locked file';
  end if;
  return old;
end $$;
```

Note the escape hatch on the first two lines. `clerk_user_id() is null` means the
service role, which must never be blocked or the purge crons break. The same
shape appears in `copy_documents_client_guard()` (0013) and in
`notifications_client_guard()` (0002/0006).

**Rule for any new cascade path: if a delete can reach a row a client should not
be able to destroy, the guard goes in a BEFORE DELETE trigger, not a policy.**

### 2.5 Guard triggers that freeze columns

RLS decides which rows you may touch. It cannot say which **columns**. Where a
client needs UPDATE on a row but only on part of it, the pattern is a BEFORE
UPDATE trigger that copies the frozen columns back from `OLD`:

| Trigger | Table | What it freezes |
| --- | --- | --- |
| `notifications_client_guard_update` | `notifications` | Everything except `read_at`. A recipient may mark a notification read, never rewrite its title, body or link. |
| `messages_edit_guard_update` | `messages` | Everything except `body`, and stamps `edited_at` when the body changes, so an edit cannot hide itself. |
| `copy_documents_client_guard_trg` | `copy_documents` | Refuses a client status change to `approved` or `changes_requested`, and refuses any change to `review_note`. |

Where a genuine column-level privilege will do, use that instead: it is stronger
because it is enforced before the trigger ever runs.

```sql
revoke update on public.notifications from authenticated;   -- 0006
grant  update (read_at) on public.notifications to authenticated;

revoke update on public.conversation_members from authenticated;  -- 0018
grant  update (last_read_at) on public.conversation_members to authenticated;
```

0006 exists because a recipient could otherwise change their own notification's
`channel` or `emailed_at`. Self-affecting only, no cross-tenant reach, but the
column grant closes it properly and the trigger stays as defence in depth.

### 2.6 Composite foreign keys pin the tenant

`reports` and `invoices` both carry a redundant-looking `unique (id, client_id)`.
That exists so children can point a composite FK at the pair:

```sql
foreign key (report_id, client_id)
  references public.reports(id, client_id) on delete cascade
```

A `report_sections` row therefore **cannot** name a report belonging to a
different tenant. The denormalised `client_id` on the child is not just an RLS
convenience, it is structurally tied to the parent's. Same for
`invoice_line_items`. Keep this shape on any new child table of a tenant-scoped
parent.

### 2.7 Partial and conditional unique indexes

These carry real business rules. They are listed together because the pattern
repeats and each one is load-bearing.

| Index | Migration | Rule it enforces |
| --- | --- | --- |
| `invoices_recurring_period_uniq` on `(recurring_source_id, recurring_period) where recurring_source_id is not null` | 0009 | The anti-double-billing guarantee. One generated invoice per template per month. A retried cron run collides and is silently skipped. |
| `asset_folders_sibling_uniq` `unique nulls not distinct (client_id, parent_id, name)` | 0010 | Siblings cannot share a name. `nulls not distinct` is what makes it apply to top-level folders too, where `parent_id` is NULL. |
| `conversations_direct_unique` on `(client_id, direct_user_id) where kind = 'direct'` | 0018 | A user holds at most one direct thread with Kyle, while a client may hold many conversations. The old `unique (client_id)` was dropped for this. |
| `crm_contacts_one_per_org` on `(organisation_id) where is_sole_contact_for_org` | 0022 | One contact per organisation, ever. A warm internal referral is the only exception and carries the flag false. |
| `work_items_source_open_idx` on `(source_kind, source_key) where state = 'open' and source_key is not null` | 0044 | The whole dashboard design. The generator runs hourly and can never make a second OPEN item for the same stage of the same thing. Partial on `open` on purpose: once an item is done or dropped it stops blocking, which is what lets a later stage of the same invoice raise a fresh one. |

The `work_items` key is a **stage, not a row**: `invoice:<id>:overdue7` and
`invoice:<id>:overdue30` are different work. That is what lets "Not doing"
suppress one nag without suppressing the invoice forever.

Filtered indexes that are purely for speed, not rules: `crm_tasks_due_idx`
(`where done_at is null`), `invoices_due_unpaid_idx` (`where status = 'sent'`),
`invoices_recurring_active_idx`, `crm_org_outbox_idx`, `crm_org_draft_idx`.

### 2.8 Grants

`0002_rls.sql` ran `grant select, insert, update, delete on all tables in schema
public to authenticated`. That applied to the fourteen tables existing at the
time and **does not apply to anything created later**. Every migration since has
granted explicitly, and a new table with no grant is invisible to the API however
good its policies are.

Two tables are deliberately narrower:

- `invoice_sends`: `grant select, insert` only. It is an append-only audit of
  what was emailed, so there is no UPDATE or DELETE privilege even for an admin.
- `email_events`: `grant select` only. Writes come from the sender and the Resend
  webhook, both service-role.

### 2.9 Storage

Two private buckets, created in 0003, both capped at 50 MB per file by 0019.

| Bucket | Holds |
| --- | --- |
| `pulse-assets` | Client and admin file uploads, plus self-generated WebP thumbnails. |
| `pulse-reports` | Report PDFs (0042) **and invoice PDFs** (0043). The bucket is named for what it was built for, not what it holds; renaming it would break every stored report path for no gain. |

Storage RLS keys off the **first path segment**, which must be the `client_id`:

```sql
(storage.foldername(name))[1] = public.current_client_id()::text
```

So `pulse-assets/<client_id>/social/header.png` is reachable by that client and
by nobody else. Any new storage path must start with the client id or it is
either unreachable or, worse, reachable by the wrong tenant. `pdf-render.ts`
follows it: `${clientId}/${id}/pdf/${Date.now()}-${keyName}.pdf`.

Both buckets are private and the app hands out short-lived signed URLs (60
minutes for browsing, 60 seconds for the `/share/[token]/raw` proxy). Never put
`next/image` in front of a signed URL: the rotating token defeats its cache and
burns the Vercel Hobby optimiser quota.

---

## 3. Tables by domain

Column lists below are the ones that carry meaning. Read the migration for the
full set.

### 3.1 Core and tenancy

#### `clients` (0001, 0007)
The tenant. `id` is the value every other table's `client_id` points at and the
first segment of every storage path.

| Column | Notes |
| --- | --- |
| `slug` | unique; used in URLs |
| `status` | `onboarding` / `active` / `paused`. "Inactive" reuses `paused` rather than adding an enum value. |
| `deleted_at` | Soft delete. Restorable for 30 days. |
| `purged_at` | Set once the daily purge has run. |

Deletion is soft on purpose: a client's **portal data** is purged after 30 days,
their **invoices never are** (ATO five-year record keeping).
`/api/cron/purge-clients` does the sweep.

#### `client_users` (0001, 0018)
The identity table. Maps a Clerk user id to a client and a role. This is what
`is_admin()` and `current_client_id()` read, and the reason both are SECURITY
DEFINER.

- `clerk_user_id` is unique. One Clerk user, one row.
- Check constraint `client_role_requires_client`: an admin has no `client_id`; a
  client must have one.
- Policies: `client_users_admin_all`, `client_users_self_read` (your own row),
  and `client_users_peer_read` from 0018 (same-company teammates, needed for
  sender names and "Seen by" receipts). A user still cannot see any other
  client's users.
- Inserting a client user fires `client_users_direct_conversation_trg`, which
  creates their direct thread with Kyle and the membership rows.

#### `services` (0001)
Which of the five service keys a client uses. `unique (client_id, service_key)`.

#### `api_connections` (0001)
Connected data sources with a `credentials` jsonb. **Admin only, no client
policy.** The column comment notes credentials should move to Supabase Vault or
pgsodium in production; see Risks.

#### `metrics` (0001)
Pulled metric values per client, service, metric key and month.
`unique (client_id, service_key, metric_key, period_month)` makes a re-pull an
upsert rather than a duplicate.

#### `business_settings` (0004, 0008, 0028)
Singleton, `id integer primary key default 1 check (id = 1)`, one row inserted by
the migration. Letterhead, ABN, bank details, `payment_terms_days`, `gst_mode`,
`invoice_email_message` (the default email body), `reminder_days_before` (0
disables the pre-due reminder). Admin only.

#### `pricing_items` (0004)
Reusable pricing catalogue. Admin only. Amounts are defaults; an invoice line may
differ.

### 3.2 Assets and documents

#### `asset_folders` (0010, 0011)
Nested folder tree by adjacency list (`parent_id`). Supersedes the flat
`assets.folder` text label, which still exists.

- `client_editable` (0011): admin-controlled view-only switch. Enforced by the
  restrictive policies and by `asset_folders_delete_guard`.
- `asset_folders_no_cycle_trg` walks the parent chain on insert and on update of
  `parent_id` and refuses a folder being made its own ancestor.
- **A folder move re-points `folder_id` only. It never moves a stored file.**
  Storage paths are stable for the life of an asset.

#### `assets` (0001, 0010)
Uploaded files. `storage_path` is the object in `pulse-assets`; `thumb_path` is
the self-generated WebP thumbnail; `locked` freezes a file against client edits;
`folder_id` is the nested folder and `folder` is the legacy text label kept from
before 0010.

Clients may insert, update and delete their **own** uploads
(`uploaded_by = clerk_user_id()` and `uploader_role = 'client'`), subject to the
0011 restrictions. They may read everything in their own client.

#### `asset_comments` (0001)
Inline feedback. The client insert policy checks the target asset belongs to the
same client, so a client cannot comment on someone else's file by guessing an id.

#### `shares` (0012)
Tokenised, revocable private share links.

- **`token_hash` only. The raw token exists only in the URL the owner copies.**
- `constraint shares_one_target check (num_nonnulls(asset_id, folder_id) = 1)`:
  exactly one target, never both, never neither.
- `expires_at`, `max_uses`, `use_count`, `revoked_at`, `last_accessed_at`,
  `require_login`.
- Resolution is server-side through the service role in `/share/[token]`, which
  mints a fresh 60-second signed URL on each authorised hit. A raw Supabase
  signed URL is never handed out: those cannot be revoked and are CDN-cached past
  expiry. **Never put one in HTML or email.**

#### `copy_documents` and `copy_document_versions` (0013)
Google-Docs-style drafting. Tiptap/ProseMirror JSON in `body_json` with periodic
snapshots in the versions table.

Status flow `draft -> submitted -> approved | changes_requested`. RLS lets a
client update their own row, so `copy_documents_client_guard_trg` is what stops a
client PATCHing straight to `approved` or writing their own `review_note`. The UI
gate is client-side only and is not the control.

#### `client_previews` (0041)
Named pages of a website build in progress, in order, with a note about what to
look at. Many rows per client on purpose: a site is not one page.

- `visible` hides a page from the client without deleting it, and **RLS enforces
  it** (`client_previews_client_read` requires `visible`), not the component.
- Rendered in an iframe. A site sending `X-Frame-Options` or a `frame-ancestors`
  policy renders blank and cross-origin rules stop the parent detecting it, which
  is why "Open in a new tab" is always on screen rather than a fallback.

### 3.3 Messaging

#### `conversations` (0017, 0018)
One thread. `kind` is `direct` (one client user plus Kyle, private from
teammates) or `group` (a chosen set plus Kyle).

- `deleted_at` / `deleted_by`: **soft delete**, hidden from both sides via the
  restrictive `messages_restrict_select` policy and restorable for 30 days.
- The `unique (client_id)` from 0017 was dropped in 0018 and replaced with the
  partial `conversations_direct_unique`.
- Client read requires membership, not just tenancy.

#### `conversation_members` (0018)
Composite primary key `(conversation_id, clerk_user_id)`. This table is **both**
the visibility boundary and the read receipt (`last_read_at`). Members see each
other's rows, which is what makes "Seen by" possible; the column grant limits an
update to `last_read_at`.

#### `messages` (0001, 0018, 0020)
`conversation_id` was added and backfilled by 0018 and made `not null` inside a
guarded block, so the migration is safe to re-run.

**Clients have no UPDATE policy on messages.** They cannot edit or re-label
(`sender_role`) a message after sending. Kyle edits through
`messages_admin_all`, and `messages_edit_guard_update` stamps `edited_at`.

`messages_ensure_conversation_trg` (BEFORE INSERT) is the routing layer:
- With an explicit `conversation_id`: validate it exists, overwrite `client_id`
  from the conversation so the denormalised column stays honest, and revive a
  soft-deleted thread.
- Without one (pre-0018 app code during the cutover): route to the sender's
  direct thread, creating it if needed.
- **Membership is granted only on threads this trigger CREATES**, never on an
  explicit id, or a teammate could write themselves into a private thread.

#### `message_reactions` (0001, 0018)
`unique (message_id, user_id, emoji)`. The client read policy leans on an
`exists` subquery against `messages`, which runs under the caller's own RLS, so
reactions on a teammate's private thread are invisible without restating the
membership rule.

#### `push_subscriptions` (0021)
One row per opted-in device. `endpoint` is unique so a re-subscribing browser
upserts rather than piling up rows. **RLS enabled, zero policies, all privileges
revoked from `anon` and `authenticated`.** Server-only.

Realtime publication members: `notifications` (0016), `messages` and
`conversation_members` (0018). RLS applies per subscriber, so nobody receives
events for a thread they cannot see. Polling stays in the app as a backstop.

### 3.4 Invoices

#### `invoices` (0004, and 0005, 0008, 0009, 0014, 0023, 0028, 0029, 0031, 0033, 0043)
The most-amended table in the schema. Grouped by what the columns are for:

**Identity and money**

| Column | Notes |
| --- | --- |
| `invoice_number` | unique. Allocated by `next_invoice_number()`. |
| `brand` | `hartwell` or `ironpeak`. Same ABN either way; only the letterhead changes. Both brands share one number sequence, deliberately: one business, one set of books. |
| `status` | `draft` / `sent` / `paid` / `void` |
| `subtotal`, `discount`, `discount_label`, `gst`, `total` | Discount is a fixed dollar amount applied before GST and shown as its own totals row. |
| `deposit_amount`, `deposit_label` | Credited against the invoice: the total stays the contract value and the deposit reduces what is left to pay. |
| `gst_mode` | `add` / `inclusive` / `none`. Kyle is **not GST-registered**, so invoices default to no GST and head "Invoice", never "Tax invoice". |

**Sending and correction (0033)**

| Column | Notes |
| --- | --- |
| `sent_at` | The FIRST send. Never moves. |
| `last_sent_at` | Carries resends. |
| `revision` | 0 as first issued; bumps only when an already-**sent** invoice is saved with changes. The client email says "Updated invoice" once revision > 0. |
| `recipient_user_ids text[] not null default '{}'` | **Empty means EVERYONE on the account**, not nobody. |
| `email_message` | Per-invoice override of the business default. |

A sent invoice may be corrected and reissued **under the same number**. For an
unpaid invoice that is the ordinary fix, and it beats voiding and raising a new
number, which leaves the client holding two documents for one job. What must
never happen is a silent change, which is what `invoice_sends` is for.

**Reminders**

`reminder_sent_at` (weekly overdue nudge) and `pre_reminder_sent_at` (the one
heads-up `reminder_days_before` days before due, sent at most once).

**Recurring (0009, 0029)**

A template is an invoice with `recurring_active = true` that is never sent
itself. The daily cron materialises it into a real, sent invoice each month.

| Column | Notes |
| --- | --- |
| `recurring_active` | true on a TEMPLATE, null on a normal invoice |
| `recurring_anchor_day` | 1 to 28, capped so February never skips a month |
| `recurring_source_id` | on a GENERATED invoice, the template it came from |
| `recurring_period` | the month it covers, first of month |
| `recurring_terms_days` | per-template payment terms; null uses the business default |

Evaluated in Australia/Brisbane. The dedup is
`invoices_recurring_period_uniq`, described in 2.7.

**PDF (0043)**: `pdf_path`, `pdf_name`, `pdf_uploaded_at`, in the `pulse-reports`
bucket. `pdf_uploaded_at` older than `updated_at` means the attachment predates
the last edit, and on a reissued invoice that means it shows superseded figures
under the same number.

Client read policy excludes drafts: `status <> 'draft'`.

#### `invoice_line_items` (0004, 0015)
Composite FK to `(invoice_id, client_id)`. `title` is a short bold line above the
description. Discounts are negative line items, netted into a Discount row in the
totals.

#### `invoice_sends` (0033)
One row per time an invoice was emailed. The audit that makes reissue-under-the-
same-number safe.

**Snapshotted, not joined.** `total`, `due_date`, `revision` and `sent_to`
(email addresses as delivered) are copied in at send time, because a later
correction is exactly what would otherwise rewrite that history, and a person
leaving the account is exactly what would otherwise erase who received it.
`kind` is `send` or `resend`. Admin only, and `grant select, insert` only, so it
is append-only.

0033 backfilled one row per already-sent invoice so the history does not start
empty.

### 3.5 Reports

#### `reports` (0001, 0030, 0032, 0042)
`unique (client_id, period_month)`: one report per client per month.
`unique (id, client_id)` exists for the composite FK from `report_sections`.

| Column | Notes |
| --- | --- |
| `status` | `draft` / `published`. Clients read published only. |
| `brand` | `hartwell` or `ironpeak`, same as invoices. |
| `summary` | Everything above the first `##` in an imported draft. Rendered and editable as "Opening". It was written by the importer and displayed by nothing for its whole life, which is the lesson: if a report field exists, check something actually displays it. |
| `recipient_user_ids` | Empty means everyone. Same rule as invoices. |
| `sent_at` | **Publish and send are separate acts.** Publish makes it visible; Send emails the chosen people and stamps this. |
| `pdf_path`, `pdf_name`, `pdf_uploaded_at` | Generated on publish by headless Chromium, stored in `pulse-reports`. |

0032 dropped the `reports_notify` trigger and the `notify_on_report_publish()`
function. Publishing used to drop a line into everyone's **weekly digest**, so a
finished report could sit unmentioned for six days and went to everyone on the
account whether or not it was meant for them. Sending is now an explicit act in
the app. Note the side effect that went with it: that function also moved any
open `report` board card to `delivered` (0005), and nothing does that now.

#### `report_sections` (0001)
Ordered sections. `content jsonb` carries per-section settings including the
`report-page-break` flag, which is why toggling a page break needed no migration.
The client read policy re-checks the parent report is published, so an unpublished
report's sections are not readable through the child table.

#### `insight_snippets` (0001)
Kyle's reusable insight library. Admin only, keyed by `owner_user_id`.

### 3.6 CRM (admin only, two brands)

Every `crm_*` table is `is_admin()` only. A client must never see a prospect.
0022 applies the policies in a `do $$` loop over a table-name array, which is the
pattern 0044 reuses.

#### `crm_organisations` (0022, 0024, 0027, 0035, 0036, 0039, 0040)
The prospect. `unique (brand, lower(legal_name))` stops duplicates across case
differences within a brand.

**Two brands, two rule sets.** `brand` is `ironpeak` or `hartwell`. The Ironpeak
gates (two-email cap, dated verified fault, nine pre-send checks) are defence
playbook strategy and fire only for `brand = 'ironpeak'`. The Spam Act
requirements are universal.

**Three different state columns, on purpose:**

| Column | Axis |
| --- | --- |
| `stage` | Where they sit in the outreach sequence, including terminals. |
| `source_status` (0027) | Kyle's qualification vocabulary before outreach starts: skip, watch, queued, advance-queued, contacted. |
| `tier` (A to D) vs `priority_tier` (1 to 3) | Research quality vs conversion tier from the handoff. Different things. |

`stage` values after 0040: `researched`, `queued`, `blocked`, `linkedin_only`,
`email_closed`, `verified`, `contacted`, `connected`, `followed_up`, `replied`,
`conversation`, `proposal`, `won`, `delivered`, `lost`, `declined`, `bounced`,
`stopped`, `do_not_contact`.

Three of those need explaining:
- **`bounced` is not terminal.** Nobody saw the message, so nobody refused
  anything. Bounced touches are also excluded from the two-email cap.
- **`email_closed` ends one channel, not all of them.** Their mail server refuses
  this sender; LinkedIn and the telephone stay open.
- **`blocked`** means the conspicuous publication that created inferred consent
  is gone (Tynbell's website went down). Email is refused outright.

**The scheduling and outbox columns are three different things and must not be
collapsed:**

| Column | Meaning |
| --- | --- |
| `scheduled_send_at` | When it is planned to go. Never on the hour or half hour, so mail reads as hand-sent. |
| `draft_created_at` (0039) | A finished draft is sitting in Outlook Drafts. Stops the cron re-drafting the same email every few minutes. |
| A `crm_touches` row | The actual send. This is what advances the stage, counts toward the goal, and stands as the Spam Act record. |

Also: `email_subject` / `email_body` (the email lives on the record),
`send_approved_at` and `send_approved_checks` (**nothing drafts without
approval**, and editing the body clears it), `send_attempted_at` / `send_error`,
`graph_message_id`, `graph_web_link` (deep link straight to the draft), `hook` and
`hook_verified_at` (the one verified fault the email leads with, and its date),
`hard_warning` (undismissable), `followup_due`, `rank`, `channel` (`DIDG` or
`AIC`), `list_id`.

#### `crm_contacts` (0022, 0024, 0035, 0036)
One contact per organisation, enforced by `crm_contacts_one_per_org`.

**The consent trail is the point of this table.** Cold outreach relies on
inferred consent under the Spam Act 2003, which attaches only to an address the
business itself conspicuously published.

| Column | Notes |
| --- | --- |
| `email_as_published` | Stored **VERBATIM**. Never trimmed, lowercased or canonicalised: the exact string as published is the evidence. |
| `email_source_url` | Where it appeared, if a URL was captured. |
| `email_source_note` (0035) | Where it appears **in words**: "footer and contact page". **NOT a URL and must never be turned into one.** Fabricating a URL fakes the one thing that has to be checkable. Either the URL or the note satisfies the guard. |
| `email_verified_at` | When it was checked. |
| `direct_email` (0024) | A personal address given later. A **different field on purpose**: overwriting `email_as_published` with it would quietly destroy the consent evidence. |
| `consent_basis` | `inferred_published` / `express` / `referral` / `none`. `none` blocks the send. |
| `relevance_note` | Required before an email can be logged. |
| `opt_out_at`, `opt_out_channel`, `opt_out_verbatim`, `opt_out_actioned_at` | Opt-out is an absolute block on every channel, for every brand. |
| `opt_out_token uuid` (0036) | Unique, unguessable. Identifies the contact on its own so `/unsubscribe/[token]` needs no other parameter and leaks nothing about anyone else. |
| `name_verified` (0035) | `own-site` names are safe to greet by name; `directory` ones have never been confirmed by the company. |
| `fallback_greeting` | Used when the name is not verified. |

#### `crm_touches` (0022)
The log of what actually happened. `direction` `out` or `in`; `channel` email,
LinkedIn note or message, reply, meeting; `sequence_step` `email_1`,
`linkedin_connect`, `email_2`, `ad_hoc`, `inbound`; `outcome` including `bounce`
and `opt_out`; `substantive` for a real reply.

- `body_snapshot` is **what was actually sent, not the template.** If a complaint
  arrives, this is the defence.
- `presend_checks jsonb` stores the nine checks **per send**. The old tracker
  stored them once and reused them, which meant they stopped being a real check
  after the first email.
- Inserting here is gated by `crm_touch_guard()`, described in section 4.

#### `crm_research` (0022)
One row per organisation (`organisation_id` is unique). The seven questions
answered from public material, plus `lead_finding_method` (naive keyword search
produced false positives, including matching "disp" inside "display" in a Wix
bundle), `technical_domain_finding`, `positive_finding`,
`keep_out_of_first_email`, `blocker`, `seven_questions` jsonb, `signals` jsonb.

`technical_domain_finding` and `positive_finding` **used to be the first-email
gate**. 0038 repointed the gate at `crm_organisations.hook` +
`hook_verified_at` instead, because the 7 August repositioning replaced that
message shape entirely and these columns hold no rows for the current pipeline.
The columns remain; the gate no longer reads them.

#### `crm_lists` (0024)
Named source lists, so a reply rate from a grant list and one from a cold trade
show never average into a single meaningless number. `slug` is unique.
`source_note` and `captured_on` are first-class provenance fields, not notes.

Ironpeak runs on exactly one list, `ironpeak-pipeline`, maintained by
`replacePipeline`. The `didg-2026` list created by 0024 is the earlier one.

#### `crm_tasks` (0022)
Follow-up reminders. `kind` is `follow_up`, `linkedin_connect`, `reverify`,
`annual_review` or `manual`. `notified_at` is a leftover from when the reminder
cron notified per task; those are `work_items` now, and `/api/cron/crm-reminders`
only books re-verify tasks.

#### `crm_opportunities`, `crm_engagements`, `crm_notes`, `crm_grants` (0022)
Supporting tables. `crm_engagements.status` in `scoped` / `in_progress` /
`content_freeze` / `delivered` / `closed` feeds the live-engagement count in
`crm_metrics()`; `capacity_engagement_limit` defaults to 2, because three yeses
in a fortnight breaks a one-person business. `crm_grants.purpose` is the public
sentence describing what a company was funded to build, which is the most useful
field for making an approach specific.

#### `crm_settings` (0022, 0023)
Singleton, `id boolean primary key default true check (id)`. Goals are 3 a day
and 15 a week (set by 0023), against a playbook benchmark of 3 a week, so the
abort warning at 15 sends with no substantive reply lands after about a week
rather than five. `reverify_after_days` 14, `abort_warning_sends` 15,
`capacity_engagement_limit` 2.

### 3.7 Work (the dashboard)

#### `work_items` (0044, 0046)
**Everything Kyle owes anyone is a row here.** The dashboard read `board_cards`
and nothing else until 0044, which is why it went unused: the work lived in the
CRM, the invoices and the reports and none of it reached the page. Design and
reasoning in `docs/dashboard-spec.md`.

| Column | Notes |
| --- | --- |
| `source_kind` | `manual`, `crm_send`, `crm_task`, `invoice`, `report`, `recurring`, `notification` |
| `source_id` | The row it stands for, for the link through. Not unique: an invoice can legitimately produce a second item later in its life. |
| `source_key` | The dedup key, a **stage** not a row. See 2.7. |
| `due_at` | Null means someday: real work, no date, never on Today. |
| `has_time` | Whether the clock matters or only the day. Read explicitly rather than inferred from a midnight timestamp, because midnight is a real answer to "what time" and a common accident. |
| `state` | `open` / `done` / `dropped`, with `done_at`, `dropped_at`, `drop_reason` |
| `snoozed_until` | Open, but out of Today until then. |
| `asked_at` | **"Still doing this?" is asked ONCE**, and this records that it was. Without it the ask is the nagging again wearing a question mark. |
| `nudged_at` (0046) | The timed nudge was sent. A different question from `asked_at`: this means "you have been told it is time". An item can need both. |
| `hours`, `hours_note` | Logged after the fact, no timer. A running clock is a thing to forget to stop, and a wrong number is worse than no number when it becomes an invoice line. |
| `position` | Manual order within a day. Null sorts after anything positioned, so dragging one item does not require positioning all of them. |

**A tick may never fabricate a record with legal or financial weight.**
`completeWork` refuses a `crm_send` and an `invoice` and says where to go
instead: the touch log is the Spam Act defence and paid means money arrived.
Neither gets decided by a checkbox among twelve others.

#### `work_item_steps` (0044)
The checklist inside one item. A six-step job is one row on Today, not six. Steps
never appear on Today in their own right.

#### `work_item_recurrences` (0044)
`pattern` weekly / monthly / quarterly / annual; `day_of_week` (0 Sunday) for
weekly, `day_of_month` (1 to 28) for the rest; `lead_days` so a monthly report is
not first mentioned on the day it is owed; `steps jsonb` as the checklist to
stamp out each time; `last_made_on` for daily-cron dedup, the same trick the
recurring invoices use.

**A recurrence per client is the answer to "what counts as a retained client":**
nothing has to infer it, Kyle sets one up once and it becomes a fact.

#### `board_cards` (0001)
The old kanban. Admin only. 0044 migrated every card into `work_items` (guarded
on a count so a re-run cannot duplicate) and **deliberately did not drop it**. It
goes when the new page has been used in anger for a while.

### 3.8 Notifications and infrastructure

#### `notifications` (0001, 0004, 0006, 0016, 0022, 0045)
Per-recipient, in-portal plus email.

- `type` after 0045: `message`, `report_ready`, `asset_feedback`,
  `asset_uploaded`, `status_change`, `invoice`, `crm_reminder`, `work_brief`.
  `crm_reminder` stays in the constraint because rows carrying it still exist and
  a check constraint validates against the whole table.
- `channel`: `in_portal`, `instant` (email now), `digest` (rolled into the daily
  or weekly digest email). `emailed_at` records that the email went.
- A recipient may only set `read_at`, enforced by both the column grant (0006)
  and `notifications_client_guard`.
- In the realtime publication since 0016; the 15-second poll stays as a fallback.

**One notification a day for Kyle's own work**: `/api/cron/brief` at 21:00 UTC,
which is 7am Brisbane, and it stays silent when nothing is due. Client-triggered
notifications are untouched, because those are someone waiting.

#### `email_events` (0034)
One row per address per message, keyed on Resend's own `provider_id` (unique) so
a webhook arriving twice updates rather than duplicates.

`status`: `sent`, `delivered`, `opened`, `clicked`, `bounced`, `complained`,
`failed`. **Status only ever moves FORWARD** through the `RANK` ladder in
`/api/webhooks/resend`, because webhooks arrive out of order and a late "sent"
must never overwrite a "bounced". That ordering is enforced in the route, not by
a constraint.

`ref_kind` / `ref_id` tie an event back to the invoice, report or message it was
about. Admin read only; every write is service-role.

`recordEmail` swallows its own failures after logging: telemetry that can stop an
invoice reaching a client is worse than no telemetry.

#### Sequence: `invoice_number_seq` (0009)
`next_invoice_number()` returns `'INV-' || lpad(nextval(...)::text, 4, '0')`.
The migration seeds the sequence from the highest digits found in any existing
`invoice_number`. `count(*)+1` was the previous approach and it races the moment
a machine issues numbers, and breaks entirely if a draft is deleted. Gaps in
invoice numbers are fine; collisions are not.

---

## 4. Functions

### Identity (0002)

| Function | Purpose |
| --- | --- |
| `clerk_user_id() -> text` | The Clerk `sub` claim. NULL under the service role, which every guard trigger uses as its "trusted server code" test. |
| `is_admin() -> boolean` | SECURITY DEFINER, so it can read `client_users` without recursing into its own policy. |
| `current_client_id() -> uuid` | Same. NULL for an admin. |

### Assets and folders

| Function | Purpose |
| --- | --- |
| `folder_editable(uuid) -> boolean` (0011) | Is this folder client-editable? NULL folder id (the root) returns true, and a missing folder coalesces to true, so nothing is accidentally frozen. Read by every restrictive policy on `assets` and `asset_folders`. |
| `asset_folders_no_cycle()` (0010) | Trigger. Walks the parent chain and refuses a folder becoming its own ancestor. |
| `asset_folders_delete_guard()` (0011) | Trigger. The cascade workaround, section 2.4. |

### Messaging

| Function | Purpose |
| --- | --- |
| `is_conversation_member(uuid) -> boolean` (0018) | SECURITY DEFINER membership check that dodges RLS recursion. Policies on `conversation_members`, `conversations` and `messages` all lean on it. |
| `conversation_client_id(uuid) -> uuid` (0018) | Which client owns a thread, for the messages insert policy, without tripping `conversations` RLS. |
| `conversation_live(uuid) -> boolean` (0018) | Is the thread not soft-deleted? Backs `messages_restrict_select`. Returns false for a missing conversation. |
| `conversation_active(uuid)` (0017) | **Dropped by 0018.** Superseded by `conversation_live`, which keys on the conversation rather than the client. Do not reintroduce. |
| `unread_message_counts() -> table(conversation_id, unread)` (0018) | **SECURITY INVOKER on purpose**: RLS trims it to threads the caller can see and the restrictive policy keeps soft-deleted threads out, so it needs no access logic of its own. Called by the nav badge and the conversation lists. |
| `messages_ensure_conversation()` (0017, rewritten 0018) | Trigger. Routing, described under `messages` above. |
| `messages_edit_guard()` (0020) | Trigger. Stamps `edited_at`, freezes everything else. |
| `client_user_direct_conversation()` (0018) | Trigger. A new client user gets their direct thread and the membership rows, ready to go. |

### Notifications

| Function | Purpose |
| --- | --- |
| `notify_on_message()` (0004, rewritten 0018) | Trigger. Notifies the thread's **members**, not the whole client. Before 0018 every client user was notified of every message, which would leak private-thread previews to teammates. Client senders are named for their teammates. |
| `notify_on_asset_comment()` (0004) | Trigger. Digest channel to the client, in-portal to Kyle. |
| `notify_on_asset_upload()` (0004, rewritten 0019) | Trigger. Kyle's notification now says which client and who uploaded what; client users hear when Kyle drops a file in for them, on the digest channel so there is no instant-email spam. |
| `notify_on_card_delivered()` (0004, amended 0005) | Trigger. Skips `card_type = 'report'` cards, which the report notification already covered. |
| `notify_on_report_publish()` (0004, 0005) | **Dropped by 0032**, along with its trigger. |
| `notifications_client_guard()` (0002, 0006) | Trigger. Freezes every column except `read_at` for a signed-in non-admin. |

### Invoices

| Function | Purpose |
| --- | --- |
| `next_invoice_number() -> text` (0009) | Atomic numbering off `invoice_number_seq`. SECURITY DEFINER; granted to `authenticated` and `service_role`. |

### Copy documents

| Function | Purpose |
| --- | --- |
| `copy_documents_client_guard()` (0013) | Trigger. A client may draft and submit; only an admin may approve, request changes, or set `review_note`. |

### CRM

| Function | Purpose |
| --- | --- |
| `crm_touch_guard()` (0022, rewritten 0025, 0035, 0038, 0040) | **The send gate.** Detail below. |
| `crm_touch_after()` (0022) | Trigger. A `reply_negative`, `bounce` or `opt_out` outcome sets the org to `do_not_contact`, stamps `opt_out_at` on the contact for an opt-out, and closes every outstanding task for that contact. |
| `crm_dry_run_touch(uuid, jsonb, text)` (0036, rewritten 0037) | Ask the guard for permission **without sending**. Detail below. |
| `crm_opt_out(uuid)` (0036) | The single narrow hole in the admin-only CRM RLS. Detail below. |
| `crm_metrics(integer, text)` (0022, rewritten 0025) | Dashboard numbers, brand-scoped. Returns sent, replies, substantive, opt-outs, sent today, live engagements, sends since the last substantive reply. **Opt-outs are the health metric and are shown first.** Two campaigns against two client bases produce two reply rates; averaging them would hide both. |
| `crm_activity_days(integer, text)` (0026) | Per-day send counts for the last N days, so the dashboard shows a streak and a fortnight of shape rather than a single number with no context. Days are Australia/Brisbane, like the recurring billing cron, so a day boundary means the same thing everywhere. |

#### `crm_touch_guard()` in detail

BEFORE INSERT on `crm_touches`. It has been rewritten four times and the current
body is in `0040_bounce_not_terminal.sql`. Order of checks, for an outbound touch:

1. Overwrite `new.organisation_id` from the contact, so the denormalised column
   cannot lie.
2. **UNIVERSAL**: `opt_out_at` set is an absolute block on every channel.
3. **UNIVERSAL**: stage in `declined`, `stopped`, `do_not_contact` is terminal on
   every channel. `bounced` was removed from this list by 0040.
4. Email only: stage `blocked` refuses (consent basis lapsed), `linkedin_only`
   refuses, `email_closed` refuses **email only** and says to use LinkedIn or the
   telephone.
5. **UNIVERSAL**: the consent evidence must be complete. `email_as_published`
   non-empty, either `email_source_url` or `email_source_note` non-empty,
   `email_verified_at` set, `consent_basis <> 'none'`, `relevance_note`
   non-empty.
6. **IRONPEAK ONLY** from here, because these are playbook rules and not law:
   - Two prior emails with no inbound reply closes the sequence. Prior emails are
     counted `where outcome is distinct from 'bounce'`, so a message nobody
     received does not spend one of the two.
   - On `email_1`: the org must carry a `hook`, it must have a
     `hook_verified_at`, and that date must be within 14 days. A website changes
     and the whole offer rests on the fault being real today.
   - All nine `presend_checks` must be `true`.

The `email_1` gate reading `hook` rather than
`crm_research.technical_domain_finding` is the 0038 change. It is **not the gate
being loosened**: a dated, re-verifiable fault on the live site is a stronger and
more checkable requirement than a free-text research note.

#### `crm_dry_run_touch(p_contact_id, p_checks, p_step)` in detail

The guard fires on INSERT, so the natural order of events is send the email and
then discover the record was refused, which leaves a message in a prospect's
inbox with no touch row behind it. That is precisely the compliance gap the log
exists to prevent.

So the sender asks first. The function inserts inside a sub-transaction, then
raises the sentinel `__crm_dry_run_ok__` to roll it back. The guard therefore
runs in full against real data and nothing survives. Any **other** error is the
guard's real refusal and is re-raised for the caller to read.

`p_step` was added by 0037 because the original hardcoded `email_1`, so a
scheduled follow-up would have been tested against the opening-email gate and
refused. It was **dropped and recreated** rather than given a defaulted third
argument: an overload differing only by a default makes every existing
two-argument call ambiguous.

Called from `src/lib/crm-send.ts` and `src/app/admin/crm/actions.ts`, always
before anything reaches the Drafts folder. A ready-to-send draft sitting in
Outlook for a record that cannot lawfully be emailed is a trap for a tired thumb.

#### `crm_opt_out(token)` in detail

Opting out is done by an anonymous visitor, so it cannot go through the
admin-only RLS the rest of the CRM uses. This function is the one narrow hole:
`security definer`, granted to `anon`, takes a token, sets `opt_out_at`, and
**returns nothing about the contact**. A wrong token is indistinguishable from a
right one that was already actioned, so the endpoint cannot be used to test
whether an address is on the list.

It also stops the company, not just the person (`stage = 'stopped'`, unless the
org is `won` or `delivered`), because one contact per company is the rule.

`/unsubscribe/[token]` still exists and still works on GET. It is simply **not
linked from any email any more**: the link pointed at portal.hartwelldigital.com,
which did not match the sending domain, made the opt-out per-recipient tracking,
and published the tie between Ironpeak and Hartwell Digital to every prospect.
The opt-out on a cold email is a reply, and honouring it is the operator's job.

### Shared

`set_updated_at()` (0001) is the trivial `new.updated_at = now()` trigger
function, attached to `reports`, `board_cards`, `invoices`,
`crm_organisations`, `crm_research`, `work_items` and `work_item_recurrences`.

---

## 5. Triggers

| Trigger | Table | Timing | Function |
| --- | --- | --- | --- |
| `reports_set_updated_at` | `reports` | BEFORE UPDATE | `set_updated_at` |
| `board_cards_set_updated_at` | `board_cards` | BEFORE UPDATE | `set_updated_at` |
| `invoices_set_updated_at` | `invoices` | BEFORE UPDATE | `set_updated_at` |
| `crm_org_set_updated_at` | `crm_organisations` | BEFORE UPDATE | `set_updated_at` |
| `crm_research_set_updated_at` | `crm_research` | BEFORE UPDATE | `set_updated_at` |
| `work_items_set_updated_at` | `work_items` | BEFORE UPDATE | `set_updated_at` |
| `work_item_recurrences_set_updated_at` | `work_item_recurrences` | BEFORE UPDATE | `set_updated_at` |
| `notifications_client_guard_update` | `notifications` | BEFORE UPDATE | `notifications_client_guard` |
| `messages_notify` | `messages` | AFTER INSERT | `notify_on_message` |
| `messages_ensure_conversation_trg` | `messages` | BEFORE INSERT | `messages_ensure_conversation` |
| `messages_edit_guard_update` | `messages` | BEFORE UPDATE | `messages_edit_guard` |
| `asset_comments_notify` | `asset_comments` | AFTER INSERT | `notify_on_asset_comment` |
| `assets_notify` | `assets` | AFTER INSERT | `notify_on_asset_upload` |
| `board_cards_notify` | `board_cards` | AFTER UPDATE | `notify_on_card_delivered` |
| `asset_folders_no_cycle_trg` | `asset_folders` | BEFORE INSERT OR UPDATE OF parent_id | `asset_folders_no_cycle` |
| `asset_folders_delete_guard_trg` | `asset_folders` | BEFORE DELETE | `asset_folders_delete_guard` |
| `copy_documents_client_guard_trg` | `copy_documents` | BEFORE UPDATE | `copy_documents_client_guard` |
| `client_users_direct_conversation_trg` | `client_users` | AFTER INSERT | `client_user_direct_conversation` |
| `crm_touch_guard_trg` | `crm_touches` | BEFORE INSERT | `crm_touch_guard` |
| `crm_touches_guard` | `crm_touches` | BEFORE INSERT | `crm_touch_guard` |
| `crm_touch_after_trg` | `crm_touches` | AFTER INSERT | `crm_touch_after` |
| `reports_notify` | `reports` | AFTER UPDATE | **Dropped by 0032.** |

Note the two entries on `crm_touches`. 0022 created `crm_touch_guard_trg` and
never dropped it; 0035, 0038 and 0040 create `crm_touches_guard` and only drop
that name. Both fire BEFORE INSERT and both call `crm_touch_guard()`. See
Risks and gaps.

---

## 6. Migration index

All 46 confirmed applied in production, 2 September 2026.

| # | File | What it changed |
| --- | --- | --- |
| 0001 | `schema.sql` | The base schema: `clients`, `client_users`, `services`, `api_connections`, `metrics`, `reports`, `report_sections`, `insight_snippets`, `assets`, `asset_comments`, `messages`, `message_reactions`, `notifications`, `board_cards`. `pgcrypto` extension and `set_updated_at()`. |
| 0002 | `rls.sql` | The whole RLS layer. `clerk_user_id()`, `is_admin()`, `current_client_id()`; grants to `authenticated`; RLS on all 14 tables; the admin-all + client-read policy pairs; `notifications_client_guard`. |
| 0003 | `storage.sql` | Private buckets `pulse-assets` and `pulse-reports`, with storage policies keyed on the client id as the first path segment. |
| 0004 | `invoices_notifications.sql` | Invoicing (`business_settings`, `pricing_items`, `invoices`, `invoice_line_items`) plus the five notification triggers. `notifications.channel` and `emailed_at`; adds `invoice` to the type constraint. |
| 0005 | `invoice_extras.sql` | `invoices.recurring`, `reminder_sent_at`. Publishing a report auto-delivers its board card; report cards stop firing a duplicate `status_change` notification. |
| 0006 | `notifications_guard.sql` | Column-level `grant update (read_at)` on `notifications` after a QA finding that a recipient could alter their own `channel`/`emailed_at`. Guard trigger extended to match. |
| 0007 | `client_lifecycle.sql` | `clients.deleted_at`, `purged_at` and an index. Soft delete, restorable for 30 days, then the portal data (never the invoices) is purged. |
| 0008 | `invoice_email.sql` | `business_settings.invoice_email_message` (default body) and `invoices.email_message` (per-invoice override). |
| 0009 | `recurring.sql` | True auto-send recurring invoices: `recurring_active`, `recurring_anchor_day`, `recurring_source_id`, `recurring_period`; the anti-double-billing unique index; `invoice_number_seq` and `next_invoice_number()`. |
| 0010 | `asset_folders.sql` | `asset_folders` (nested tree, sibling-name uniqueness with `nulls not distinct`, cycle guard). `assets.folder_id`, `thumb_path`, `locked`. Backfills a top-level folder per legacy label. |
| 0011 | `permissions.sql` | `asset_folders.client_editable`, `folder_editable()`, six RESTRICTIVE policies, and `asset_folders_delete_guard` for the cascade-does-not-recheck-RLS hole. |
| 0012 | `shares.sql` | `shares`: hashed tokens, single target check, expiry, use cap, revocation. |
| 0013 | `copy_documents.sql` | `copy_documents` and `copy_document_versions` (ProseMirror JSON plus snapshots), with a guard stopping a client approving their own copy. |
| 0014 | `invoice_discount.sql` | `invoices.discount`, `discount_label`. Fixed-dollar discount applied before GST, shown as its own totals row. |
| 0015 | `line_item_title.sql` | `invoice_line_items.title`, a short bold line above the description. |
| 0016 | `realtime_notifications.sql` | Adds `notifications` to the `supabase_realtime` publication. |
| 0017 | `conversations.sql` | `conversations` with soft delete and restore; `conversation_active()`; the restrictive select policy hiding deleted threads from both sides; ensure-conversation trigger; backfill. |
| 0018 | `conversation_members.sql` | Multi-user messaging. `conversations.kind` / `direct_user_id` / `title`; `conversation_members` as visibility boundary and read receipt; `messages.conversation_id`; `is_conversation_member`, `conversation_client_id`, `conversation_live`, `unread_message_counts`; message routing rewritten; `client_users_peer_read`; realtime on `messages` and `conversation_members`; drops `conversation_active`. |
| 0019 | `upload_notifications_caps.sql` | Upload notifications say which client, who and what, and clients hear when Kyle adds a file. 50 MB per-file cap on both buckets. |
| 0020 | `message_edits.sql` | `messages.edited_at` and `messages_edit_guard`, so an edit cannot hide itself. |
| 0021 | `push_subscriptions.sql` | `push_subscriptions`. RLS on, **no policies**, all privileges revoked from `anon` and `authenticated`. Server-only. |
| 0022 | `crm_schema.sql` | The CRM: 10 tables, admin-only RLS applied in a loop, `crm_touch_guard` (opt-out block, consent evidence, two-email cap, first-email gate, nine checks), `crm_touch_after`, `crm_metrics`. Adds `crm_reminder` to the notification types. |
| 0023 | `invoice_brand.sql` | `invoices.brand` (`hartwell` / `ironpeak`, one shared number sequence), `deposit_amount`, `deposit_label`. Sets the CRM goals to 3 a day, 15 a week. |
| 0024 | `crm_lists_and_contact_details.sql` | `crm_lists` and `crm_organisations.list_id`; seeds the `didg-2026` list and assigns everything imported so far. `crm_contacts.phone` and `direct_email`, kept separate from `email_as_published`. |
| 0025 | `crm_brands.sql` | Splits the guard into universal rules (opt-out, Spam Act consent trail) and Ironpeak-only playbook rules. `crm_metrics` gains a brand parameter. |
| 0026 | `crm_activity_days.sql` | `crm_activity_days(days, brand)`: per-day send counts in Australia/Brisbane. |
| 0027 | `crm_source_status.sql` | `crm_organisations.source_status` and `next_action`. A separate axis from `stage`, so "queued" and "next up" stay distinct and a skipped company keeps its reason. |
| 0028 | `invoice_pre_reminders.sql` | `business_settings.reminder_days_before`, `invoices.pre_reminder_sent_at`, and an index for the daily sweep. The reminder that prevents lateness rather than chasing it. |
| 0029 | `recurring_terms.sql` | `invoices.recurring_terms_days`. Per-template payment terms; null means the business default. |
| 0030 | `report_brand.sql` | `reports.brand` with a check constraint, defaulting to `hartwell`. |
| 0031 | `invoice_recipients.sql` | `invoices.recipient_user_ids text[]`. **Empty means everyone on the account.** |
| 0032 | `report_send.sql` | `reports.recipient_user_ids`, `sent_at`, `email_message`. **Drops the `reports_notify` trigger and `notify_on_report_publish()`**: publish and send become separate acts. |
| 0033 | `invoice_amend_resend.sql` | `invoices.revision` and `last_sent_at`; the `invoice_sends` audit table (snapshotted, append-only, admin only); backfills a row per already-sent invoice. |
| 0034 | `email_delivery.sql` | `email_events`, keyed on Resend's message id. Admin read only, service-role writes. |
| 0035 | `pipeline_v2_send_plan.sql` | The 7 August pipeline: `rank`, `priority_tier`, `channel`, `scheduled_send_at`, `scheduled_at`, `followup_due`, `hook`, `hook_verified_at`, `pipeline_notes`, `hard_warning`; contact `name_verified`, `email_source_note`, `fallback_greeting`; stage list gains `queued`, `blocked`, `linkedin_only`, `declined`, `bounced`, `stopped`; guard refuses blocked, LinkedIn-only and terminal records, and accepts a source note in place of a URL. |
| 0036 | `crm_outbox.sql` | `email_subject`, `email_body`, `send_approved_at`, `send_approved_checks`, `send_attempted_at`, `send_error`, `graph_message_id`; `crm_contacts.opt_out_token`; `crm_dry_run_touch()`; `crm_opt_out()` granted to `anon`. |
| 0037 | `dry_run_step.sql` | `crm_dry_run_touch` gains `p_step`, dropped and recreated rather than overloaded, so a follow-up is not tested against the opening-email gate. |
| 0038 | `email1_gate_v3.sql` | The first-email gate stops reading `crm_research` findings and reads `hook` plus a `hook_verified_at` no older than 14 days. |
| 0039 | `outlook_drafts.sql` | `draft_created_at` and `graph_web_link`. The portal drafts into Outlook; Kyle presses send. Four Graph sends produced four `550 5.7.708` rejections. |
| 0040 | `bounce_not_terminal.sql` | `bounced` stops being terminal and stops counting against the two-email cap. New stage `email_closed`, which ends email only. |
| 0041 | `client_previews.sql` | `client_previews`. RLS enforces `visible`, so hiding a page is a data rule, not a component. |
| 0042 | `report_pdf.sql` | `reports.pdf_path`, `pdf_name`, `pdf_uploaded_at`. The PDF travels with the send email. |
| 0043 | `invoice_pdf.sql` | The same three columns on `invoices`. Rendered on demand, and **a missing PDF never stops an invoice send**, because the recurring cron sends with nobody watching. |
| 0044 | `work_items.sql` | `work_items`, `work_item_steps`, `work_item_recurrences`; the partial unique index the dashboard rests on; admin-only RLS; migrates `board_cards` across without dropping it. |
| 0045 | `work_brief_notification.sql` | Adds `work_brief` to the notification type constraint. |
| 0046 | `work_nudged.sql` | `work_items.nudged_at`, so a timed nudge is sent once and not every hour. |

---

## 7. The TypeScript mirror

`src/lib/types/database.ts` hand-mirrors the schema. Column names match the SQL
exactly so queries stay honest. There is **no generated Supabase types file**, so
the mirror drifts silently: nothing fails to compile when a migration adds a
column the interface does not know about.

Types that live elsewhere: `WorkItem`, `WorkStep`, `WorkRow`, `WorkSourceKind`
and `WorkState` are in `src/lib/work-shared.ts`, deliberately free of server-only
imports so the Today list (a client component) and the server data layer can both
use them.

Known drift as of 2 September 2026 (see Risks and gaps):

- `NotificationType` lists six values; the database constraint allows eight
  (`crm_reminder` from 0022, `work_brief` from 0045).
- `CrmOrganisation` is missing `draft_created_at`, `graph_web_link` and
  `graph_message_id`, all of which the app reads and writes through untyped
  query strings.
- No interfaces at all for `client_previews`, `push_subscriptions`,
  `crm_opportunities`, `crm_engagements`, `crm_notes` or
  `work_item_recurrences`. Those tables are queried with untyped strings.

**When you add a column, update this file in the same change.** The money rule in
`CLAUDE.md` is the sharp end of the same problem: `saveInvoice` once wrote a
column that did not exist yet, the whole update was rejected, and a client was
emailed an invoice for $0.00 on the wrong terms. **Always check the error on a
write**, and adding a column to an existing write is exactly the moment it bites,
because code ships before the migration is pasted.

---

## 8. Things the database does not enforce

Worth knowing, because reading the schema alone would suggest otherwise.

- **Recipient resolution.** `recipient_user_ids = '{}'` meaning "everyone" is a
  convention, not a constraint. It is implemented once, in `resolveRecipients()`
  in `src/lib/recipients.ts` and `invoiceRecipients()` in
  `src/lib/invoices-send.ts`. An **empty result means stop**, never fall back to
  everyone, because that would email precisely the person who was deselected. A
  chosen id that has left the account drops out and the send throws.
- **Email attachments are wired in exactly two places**:
  `src/lib/invoices-send.ts` and `src/lib/reports-send.ts`. The invoice send and
  the report send carry the PDF. **The due-soon reminder and the overdue nudge in
  `src/app/api/cron/overdue/route.ts` attach nothing**: they send HTML plus a
  portal link, even though the invoice's `pdf_path` is sitting right there. That
  is a known gap, not a decision anyone recorded.
- **Email status ordering.** `email_events.status` moving only forward is
  enforced by the `RANK` map in `/api/webhooks/resend`, not by a constraint or a
  trigger. A direct write could move a `bounced` row back to `sent`.
- **Invoice locking.** Paid and void invoices being uneditable is enforced in
  `saveInvoice` and in the UI, not by a database rule.
- **Nothing renders inside a server action.** An action inherits the page's ten
  seconds on Vercel Hobby and a cold Chromium start does not finish in ten.
  Rendering happens in route handlers with `maxDuration = 60`.

---

## Open questions

- **`api_connections.credentials` is plain `jsonb`.** The 0001 comment says it
  "should be encrypted (Supabase Vault / pgsodium) in production". Nothing in the
  migrations does that, and I could not determine whether any real credential has
  ever been stored in the column or whether the table is empty. If it holds live
  OAuth tokens, they are readable by anyone holding the service-role key with no
  second layer.
- **Whether `crm_touch_guard_trg` still exists in the live database.** The
  migration files say it must, since nothing drops it, but that is an inference
  from the SQL rather than a probe. A `select tgname from pg_trigger where
  tgrelid = 'public.crm_touches'::regclass` settles it in one query.
- **Whether the `didg-2026` list still has rows attached.** `replacePipeline`
  creates `ironpeak-pipeline`, moves all 30 records onto it and deletes any other
  empty Ironpeak list, so `didg-2026` has probably been deleted. Not verified
  against the live data.
- **`assets.folder`, the legacy text label.** 0010 called it a transition
  measure. It is still there and still in the `Asset` interface. Nothing in the
  migrations retires it and I could not tell from the schema alone whether new
  uploads still write it.
- **`crm_tasks.notified_at`** is written by nothing I found after the reminder
  cron stopped notifying per task. Likely dead, not confirmed.
- **Orphaned PDFs.** Deleting an asset removes its object
  (`AssetViewer.tsx`), and `/api/cron/purge-clients` removes a purged client's
  objects in batches of 100. But a `reports` or `invoices` row deleted by a
  cascade (a client hard-deleted, say) takes its `pdf_path` with it and nothing
  sweeps the file out of `pulse-reports`. Whether that path is ever exercised in
  practice was not established.

## Risks and gaps

- **Two BEFORE INSERT triggers on `crm_touches` run the same guard.** 0022's
  `crm_touch_guard_trg` was never dropped; 0035, 0038 and 0040 install
  `crm_touches_guard` and only drop that name. Both execute
  `crm_touch_guard()`, so the whole gate, including the counting subqueries,
  runs twice on every touch insert and every dry run. It is functionally
  harmless today because the guard is idempotent, but it doubles the work, it
  means an error message can be produced by either trigger, and the next person
  editing the gate has two triggers to keep in step. **Fix: drop
  `crm_touch_guard_trg` and keep `crm_touches_guard`.** One line, and it should
  be its own migration so the change is recorded.
- **`database.ts` is out of date and nothing catches it.** `NotificationType`
  omits `crm_reminder` and `work_brief`; `CrmOrganisation` omits
  `draft_created_at`, `graph_web_link` and `graph_message_id`; several tables
  have no interface at all. Because the Supabase client is not generically typed
  against a generated schema, none of this is a compile error. Given the $0.00
  invoice incident, a stale type layer on the money path is not a cosmetic
  problem. Consider generating types with `supabase gen types typescript` and
  diffing against the hand-written file.
- **Applied state is still untracked.** The probe works but it is manual and it
  is easy to skip. The cheapest durable fix is a `schema_migrations` table that
  each migration inserts its own number into as its last statement, guarded with
  `on conflict do nothing`. That turns "did 0047 run" into one select.
- **The overdue and due-soon reminder emails carry no PDF.** Both read the
  invoice row, which has `pdf_path` on it, and neither attaches it. A client
  being chased for payment is exactly the person who most needs the document in
  front of them rather than behind a login.
- **0032 silently removed the report-to-board-card automation.** Dropping
  `notify_on_report_publish()` also dropped the `update board_cards set
  column_key = 'delivered'` that 0005 had put inside it. Nothing replaced it.
  This matters less now that `work_items` supersedes the board, but it is an
  example of behaviour disappearing because it was hidden inside a function
  named for something else.
- **`invoices.recurring` (0005) and `invoices.recurring_active` (0009) are two
  columns about the same idea.** 0009's model is the live one. The older boolean
  is still in the table and in the `Invoice` interface. Two flags for one concept
  is how a cron ends up disagreeing with the UI.
- **The 0002 blanket grant does not cover new tables.** `grant ... on all tables
  in schema public` is a point-in-time operation. Every migration since has
  remembered to grant explicitly; the day one forgets, the table will look
  correctly policed and simply return nothing.
- **`crm_research` still holds columns the gate no longer reads.**
  `technical_domain_finding` and `positive_finding` are documented in
  `database.ts` as "the send gate", which stopped being true at 0038. That
  comment will mislead someone.
- **`board_cards` is live, migrated and undropped**, and it still has its own
  notification trigger firing. A card moved to `delivered` today still creates a
  `status_change` notification for the client, independently of anything in
  `work_items`.
- **Storage cleanup is per-code-path, not per-row.** `pdf-render.ts` removes the
  previous PDF when it writes a new one, `AssetViewer` removes the object when it
  deletes the row, and the purge cron removes a client's prefix. All careful, and
  all in application code. A row removed by an FK cascade takes no object with
  it, because Postgres knows nothing about Supabase Storage. Nothing breaks; the
  bucket just grows.
