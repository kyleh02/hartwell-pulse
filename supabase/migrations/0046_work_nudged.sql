-- =============================================================================
-- 0046 — remember that a timed item was nudged
--
-- The agreed rule was a morning brief PLUS a nudge for anything with a real
-- clock on it. The brief shipped; the nudge did not, because there was nowhere
-- to record that one had been sent, and a nudge with no memory is the nagging
-- again: the hourly cron would fire the same one every hour until the item was
-- closed.
--
-- Separate from asked_at, which answers a different question. asked_at means
-- "you have been asked whether this is still happening"; this means "you have
-- been told it is time". An item can legitimately need both.
--
-- Run after 0045. Idempotent.
-- =============================================================================

alter table public.work_items
  add column if not exists nudged_at timestamptz;

comment on column public.work_items.nudged_at is
  'When the timed nudge was sent for this item. Set once, so an 08:47 send is announced at 08:47 and not again at 09:47.';
