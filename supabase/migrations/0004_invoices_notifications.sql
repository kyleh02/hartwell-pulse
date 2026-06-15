-- =============================================================================
-- Hartwell Pulse — 0004 notifications (Phase 7) + invoicing
-- Run after 0001-0003. Adds email/digest support + DB triggers that create
-- in-portal notifications on events, plus the invoicing tables.
-- =============================================================================

-- ---------- notifications: add channel + email tracking, allow 'invoice' ----------
alter table public.notifications
  add column if not exists channel text not null default 'in_portal',
  add column if not exists emailed_at timestamptz;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'report_ready', 'asset_feedback', 'asset_uploaded', 'status_change', 'invoice'));

-- =============================================================================
-- Notification triggers. All SECURITY DEFINER so they create rows regardless of
-- who performed the action (clients write via the browser client under RLS).
-- =============================================================================

create or replace function public.notify_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; preview text;
begin
  preview := case when coalesce(NEW.body, '') = '' then 'Sent an attachment' else left(NEW.body, 140) end;
  if NEW.sender_role = 'admin' then
    for r in select clerk_user_id from public.client_users where client_id = NEW.client_id and role = 'client' loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'message', 'New message from Kyle', preview, '/messages', 'instant');
    end loop;
  else
    for r in select clerk_user_id from public.client_users where role = 'admin' loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'message', 'New message from a client', preview, '/admin/messages', 'in_portal');
    end loop;
  end if;
  return NEW;
end; $$;
drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_on_message();

create or replace function public.notify_on_asset_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if NEW.author_role = 'admin' then
    for r in select clerk_user_id from public.client_users where client_id = NEW.client_id and role = 'client' loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'asset_feedback', 'Kyle left a note on your upload', left(NEW.body, 140), '/assets', 'digest');
    end loop;
  else
    for r in select clerk_user_id from public.client_users where role = 'admin' loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'asset_feedback', 'New comment from a client', left(NEW.body, 140), '/admin/assets', 'in_portal');
    end loop;
  end if;
  return NEW;
end; $$;
drop trigger if exists asset_comments_notify on public.asset_comments;
create trigger asset_comments_notify after insert on public.asset_comments
  for each row execute function public.notify_on_asset_comment();

create or replace function public.notify_on_asset_upload()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if NEW.uploader_role = 'client' then
    for r in select clerk_user_id from public.client_users where role = 'admin' loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'asset_uploaded', 'New asset uploaded', NEW.name, '/admin/assets', 'in_portal');
    end loop;
  end if;
  return NEW;
end; $$;
drop trigger if exists assets_notify on public.assets;
create trigger assets_notify after insert on public.assets
  for each row execute function public.notify_on_asset_upload();

create or replace function public.notify_on_report_publish()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if NEW.status = 'published' and (OLD.status is distinct from 'published') then
    for r in select clerk_user_id from public.client_users where client_id = NEW.client_id and role = 'client' loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'report_ready',
        'Your ' || to_char(NEW.period_month, 'FMMonth') || ' report is ready to view',
        NEW.title, '/reports/' || NEW.id, 'digest');
    end loop;
  end if;
  return NEW;
end; $$;
drop trigger if exists reports_notify on public.reports;
create trigger reports_notify after update on public.reports
  for each row execute function public.notify_on_report_publish();

create or replace function public.notify_on_card_delivered()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if NEW.column_key = 'delivered' and OLD.column_key is distinct from 'delivered' and NEW.client_id is not null then
    for r in select clerk_user_id from public.client_users where client_id = NEW.client_id and role = 'client' loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'status_change', NEW.title || ' is ready', null, '/dashboard', 'digest');
    end loop;
  end if;
  return NEW;
end; $$;
drop trigger if exists board_cards_notify on public.board_cards;
create trigger board_cards_notify after update on public.board_cards
  for each row execute function public.notify_on_card_delivered();

-- =============================================================================
-- Invoicing
-- =============================================================================

-- Singleton business settings (one row) for the invoice letterhead + bank details
create table if not exists public.business_settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null default 'Hartwell Digital',
  abn text,
  address text,
  email_from text,
  bank_name text,
  bank_bsb text,
  bank_account text,
  payment_terms_days integer not null default 14,
  gst_mode text not null default 'add' check (gst_mode in ('add', 'inclusive', 'none')),
  updated_at timestamptz not null default now()
);
insert into public.business_settings (id) values (1) on conflict (id) do nothing;

-- Reusable pricing catalogue (Kyle sets the fixed amounts; amendable per invoice)
create table if not exists public.pricing_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  tier text,
  description text,
  default_amount numeric not null default 0,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  invoice_number text not null unique,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  issue_date date not null default current_date,
  due_date date not null,
  gst_mode text not null default 'add' check (gst_mode in ('add', 'inclusive', 'none')),
  subtotal numeric not null default 0,
  gst numeric not null default 0,
  total numeric not null default 0,
  notes text,
  created_by text,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, client_id)
);
create index if not exists invoices_client_id_idx on public.invoices(client_id);
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_amount numeric not null default 0,
  amount numeric not null default 0,
  position integer not null default 0,
  foreign key (invoice_id, client_id)
    references public.invoices(id, client_id) on delete cascade
);
create index if not exists invoice_line_items_invoice_id_idx on public.invoice_line_items(invoice_id);

-- ---------- RLS for the new tables ----------
grant select, insert, update, delete on
  public.business_settings, public.pricing_items, public.invoices, public.invoice_line_items
  to authenticated;

alter table public.business_settings enable row level security;
alter table public.pricing_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;

-- business_settings + pricing_items: admin only
create policy business_settings_admin_all on public.business_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pricing_items_admin_all on public.pricing_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- invoices: admin all; client reads its own, but never drafts
create policy invoices_admin_all on public.invoices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy invoices_client_read on public.invoices
  for select to authenticated
  using (client_id = public.current_client_id() and status <> 'draft');

create policy invoice_line_items_admin_all on public.invoice_line_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy invoice_line_items_client_read on public.invoice_line_items
  for select to authenticated
  using (
    client_id = public.current_client_id()
    and exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and i.client_id = invoice_line_items.client_id
        and i.status <> 'draft'
    )
  );
