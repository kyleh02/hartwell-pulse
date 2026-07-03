-- =============================================================================
-- Hartwell Pulse — 0016 realtime notifications
-- Enable Supabase Realtime for the notifications table so the bell + tab badge
-- update instantly on a new notification (the 15s poll stays as a fallback).
-- Safe to run if the table is already in the publication. Run after 0015.
-- =============================================================================

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
end $$;
