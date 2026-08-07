-- Did the email actually land?
--
-- Twice now that question has had no answer. A client received an invoice for
-- $0.00 and the only way to find out was for him to say so, and a partner
-- replied "I cant see this" to an email nobody had meant to send him. Resend
-- knows whether a message was delivered, bounced or complained about; it just
-- was not being asked.
--
-- One row per address per message, keyed on Resend's own message id so a
-- webhook that arrives twice updates rather than duplicates. Webhooks arrive
-- out of order, so status only ever moves FORWARD through the ladder below,
-- enforced in the route: a late "sent" must never overwrite a "bounced".
--
-- Run after 0033. Idempotent.

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  -- Resend's message id. Null only if a send failed before Resend replied.
  provider_id text unique,
  recipient text not null,
  subject text,
  -- What this was about, so it can be shown next to the thing it belongs to.
  ref_kind text check (ref_kind in ('invoice', 'report', 'message', 'other')),
  ref_id uuid,
  status text not null default 'sent'
    check (status in ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed')),
  detail text,
  sent_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_events_ref_idx
  on public.email_events (ref_kind, ref_id, sent_at desc);
create index if not exists email_events_recipient_idx
  on public.email_events (recipient, sent_at desc);

-- Admin only. This is delivery telemetry for Kyle; a client has no use for it
-- and their own address turning up in a table they can read is not a feature.
alter table public.email_events enable row level security;
grant select on public.email_events to authenticated;

drop policy if exists email_events_admin_read on public.email_events;
create policy email_events_admin_read on public.email_events
  for select to authenticated
  using (public.is_admin());

-- Writes come from the webhook and the sender, both service-role, so no insert
-- or update policy is granted to authenticated at all.
