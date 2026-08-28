-- =============================================================================
-- 0044 — work items: one spine for everything Kyle has to do
--
-- The dashboard has read one table since 0001 while the work lived in five,
-- and the notifications nagged because they were announcements with no verb:
-- read_at and nothing else, so the reminder cron recreated yesterday's every
-- morning and reading one changed nothing.
--
-- A work item is the unit. A CRM send, an overdue invoice, a report to publish
-- and a note to self are all rows of the same shape, each remembering where it
-- came from so closing one can act on its source.
--
-- Design agreed 26 August 2026. Full reasoning in docs/dashboard-spec.md.
-- Run after 0043. Idempotent.
-- =============================================================================

create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  detail text,
  client_id uuid references public.clients(id) on delete cascade,
  -- Which side of the business. Null for work that is neither.
  brand text check (brand in ('hartwell', 'ironpeak')),

  -- When it is due. Null means someday: real work, no date, never on Today.
  due_at timestamptz,
  -- Whether the CLOCK matters or only the day. An Ironpeak send at 08:47 is
  -- true; "chase this invoice" is false. Ordering and the timed nudge both
  -- read this rather than guessing from whether the time is midnight, because
  -- midnight is a real answer to "what time" and a common accident.
  has_time boolean not null default false,

  source_kind text not null default 'manual'
    check (source_kind in (
      'manual', 'crm_send', 'crm_task', 'invoice', 'report',
      'recurring', 'notification'
    )),
  -- The row this stands for, for the link through. Not unique: an invoice can
  -- legitimately produce a second item later in its life.
  source_id uuid,
  -- What makes it unique, and it is a STAGE not a row. "invoice:<id>:due3"
  -- and "invoice:<id>:overdue7" are different work even though they are the
  -- same invoice. This is what lets Not doing suppress one nag without
  -- suppressing the invoice forever: drop the 7-day item and the 30-day one
  -- still arrives, because it carries a different key.
  source_key text,

  state text not null default 'open'
    check (state in ('open', 'done', 'dropped')),
  done_at timestamptz,
  dropped_at timestamptz,
  -- One line, optional. A decision not to do something is worth being able to
  -- read back later; "no longer relevant" six weeks on is not an answer.
  drop_reason text,
  -- Open, but out of Today until then.
  snoozed_until timestamptz,

  -- "Still doing this?" is asked ONCE, and this records that it was. Without
  -- it the ask is just the nagging again, wearing a question mark.
  asked_at timestamptz,

  -- Manual order within a day. Null sorts after anything positioned, so
  -- dragging one item does not require positioning all of them.
  position integer,

  -- Logged after the fact, no timer. A running clock is a thing to forget to
  -- stop, and a wrong number is worse than no number when it becomes an
  -- invoice line.
  hours numeric(6,2) check (hours is null or hours >= 0),
  hours_note text,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The index the whole design rests on.
--
-- A generator may run every hour and can never make a second open item for the
-- same stage of the same thing. Without it the dashboard becomes the
-- notification problem again, in a nicer font. Partial on `open` deliberately:
-- once an item is done or dropped it stops blocking, which is what allows a
-- later stage of the same invoice to raise a fresh one.
create unique index if not exists work_items_source_open_idx
  on public.work_items (source_kind, source_key)
  where state = 'open' and source_key is not null;

create index if not exists work_items_due_idx
  on public.work_items (state, due_at);
create index if not exists work_items_client_idx
  on public.work_items (client_id, state);

drop trigger if exists work_items_set_updated_at on public.work_items;
create trigger work_items_set_updated_at
  before update on public.work_items
  for each row execute function public.set_updated_at();

-- ---------- steps: the checklist inside one item ----------
--
-- A six-step job is one row on Today, not six. The list stays short and
-- "Haus of Vitality August report" reads as one job with 3 of 6 done. Steps
-- never appear on Today in their own right.
create table if not exists public.work_item_steps (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null
    references public.work_items(id) on delete cascade,
  label text not null,
  done_at timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists work_item_steps_item_idx
  on public.work_item_steps (work_item_id, position);

-- ---------- recurrences: the work that comes back ----------
--
-- Monthly reports, the weekly ad check, quarterly BAS, per-client rhythms.
--
-- A recurrence rather than a global rule is also the answer to "what counts as
-- a retained client": nothing has to infer it, because Kyle sets one up per
-- client once and it is then a fact rather than a guess.
create table if not exists public.work_item_recurrences (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  detail text,
  client_id uuid references public.clients(id) on delete cascade,
  brand text check (brand in ('hartwell', 'ironpeak')),

  pattern text not null
    check (pattern in ('weekly', 'monthly', 'quarterly', 'annual')),
  -- weekly reads day_of_week (0 Sunday); the rest read day_of_month.
  day_of_week integer check (day_of_week between 0 and 6),
  day_of_month integer check (day_of_month between 1 and 28),
  -- Appear this many days before it is due, so a monthly report is not first
  -- mentioned on the day it is owed.
  lead_days integer not null default 0,

  -- The checklist to stamp out each time, as [{ "label": "..." }].
  steps jsonb not null default '[]'::jsonb,

  active boolean not null default true,
  -- Dedup for a daily cron, the same trick the recurring invoices use.
  last_made_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_item_recurrences_active_idx
  on public.work_item_recurrences (active, pattern);

drop trigger if exists work_item_recurrences_set_updated_at
  on public.work_item_recurrences;
create trigger work_item_recurrences_set_updated_at
  before update on public.work_item_recurrences
  for each row execute function public.set_updated_at();

-- ---------- RLS: admin only ----------
--
-- This is Kyle's own work, including items that name a client. A client must
-- never see the list of things being done about them, so these are is_admin()
-- rather than client_id-scoped. Same pattern as the crm_* tables.
do $$
declare t text;
begin
  foreach t in array array['work_items', 'work_item_steps', 'work_item_recurrences']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

-- ---------- bring the old board across ----------
--
-- Every existing card becomes a work item, once. Guarded on the count so
-- re-running this migration cannot duplicate them, and the old table is left
-- exactly where it is: nothing is dropped until the new dashboard has been
-- used in anger for a while.
do $$
begin
  if not exists (select 1 from public.work_items where source_kind = 'manual' and source_key like 'board_card:%') then
    insert into public.work_items
      (title, detail, client_id, due_at, has_time, source_kind, source_key,
       state, done_at, position, created_by, created_at)
    select
      c.title,
      c.description,
      c.client_id,
      -- A card's due date is a day, never a time.
      case when c.due_date is not null
        then (c.due_date::timestamp at time zone 'Australia/Brisbane')
        else null end,
      false,
      'manual',
      'board_card:' || c.id::text,
      case when c.column_key = 'delivered' then 'done' else 'open' end,
      case when c.column_key = 'delivered' then c.updated_at else null end,
      c.position,
      c.created_by,
      c.created_at
    from public.board_cards c;
  end if;
end $$;
