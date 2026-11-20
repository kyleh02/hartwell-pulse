-- =============================================================================
-- 0066: Draper, Stage 6. Replies, and sending on weekends.
--
-- 1. outreach_settings.send_weekends: Saturdays and Sundays count as sending
--    days when it's on (Kyle, 20 November 2026). Off by default, so nothing
--    changes until a new settings version turns it on. Public holidays and
--    the pause dates still stop sending.
--
-- 2. outreach_state.replies_checked_at: when the tick last read kyle@'s new
--    mail (every ten minutes). auto_rules_since: when Kyle last resumed after
--    a pause; the auto-pause rules count real first emails from then, so a
--    pause he has looked at and lifted doesn't fire again on the same
--    evidence.
--
-- 3. leads.source gains 'outreach': a business that replied to an outreach
--    email and was labelled interested or question becomes a lead, due today.
--
-- 4. An index for reading a prospect's replies.
--
-- Nothing is dropped or rewritten. Safe to run more than once.
-- =============================================================================

alter table public.outreach_settings
  add column if not exists send_weekends boolean not null default false;

alter table public.outreach_state
  add column if not exists replies_checked_at timestamptz,
  add column if not exists auto_rules_since timestamptz;

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('website', 'quiz', 'audit', 'referral', 'manual', 'outreach', 'other'));

create index if not exists outreach_replies_prospect_idx on public.outreach_replies (prospect_id, received_at);

notify pgrst, 'reload schema';
