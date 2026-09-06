-- =============================================================================
-- Hartwell Pulse — 0049 default hourly rate
--
-- The standard rate charged by the hour, set once in Settings and filled into
-- every hourly invoice. An invoice still stores its OWN hourly_rate (0048), so
-- changing this later does not reach back and rewrite what was already billed.
--
-- This is what makes the standard rate knowable. Before it, the rate was worked
-- out from the lines, which cannot work on the invoice that needs it most: the
-- moment one line is billed at something else the lines disagree, no single rate
-- can honestly be read off them, and the button for putting a line back on the
-- standard had nothing to put it back to.
--
-- Nullable. With no default set the invoice falls back to its own rate, then to
-- the lines, exactly as before. Run after 0048.
-- =============================================================================

alter table public.business_settings
  add column if not exists default_hourly_rate numeric(12, 2);
