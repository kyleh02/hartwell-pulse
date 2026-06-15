-- =============================================================================
-- Hartwell Pulse — 0005 invoice extras + report->board automation
-- Run after 0004. Adds recurring + reminder tracking to invoices, makes a
-- published report auto-complete its board card, and stops the duplicate
-- "card delivered" notification for report cards.
-- =============================================================================

alter table public.invoices
  add column if not exists recurring boolean not null default false,
  add column if not exists reminder_sent_at timestamptz;

-- Publishing a report also moves any open "report" board card for that client
-- to Delivered (the calendar/board reflects that the report has gone out).
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
    update public.board_cards set column_key = 'delivered'
      where client_id = NEW.client_id and card_type = 'report' and column_key <> 'delivered';
  end if;
  return NEW;
end; $$;

-- Report cards are already covered by the report_ready notification, so don't
-- also fire a status_change notification when they move to Delivered.
create or replace function public.notify_on_card_delivered()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if NEW.column_key = 'delivered' and OLD.column_key is distinct from 'delivered'
     and NEW.client_id is not null and NEW.card_type <> 'report' then
    for r in select clerk_user_id from public.client_users where client_id = NEW.client_id and role = 'client' loop
      insert into public.notifications (recipient_user_id, client_id, type, title, body, link, channel)
      values (r.clerk_user_id, NEW.client_id, 'status_change', NEW.title || ' is ready', null, '/dashboard', 'digest');
    end loop;
  end if;
  return NEW;
end; $$;
