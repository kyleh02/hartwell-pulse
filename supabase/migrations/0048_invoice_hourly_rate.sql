-- =============================================================================
-- Hartwell Pulse — 0048 invoice default hourly rate
--
-- The standard rate an hourly invoice bills at, e.g. 95. Each line still carries
-- its own unit_amount, which IS that line's rate, so the maths is unchanged and
-- a line may be billed at something other than the standard. This column is what
-- the other lines follow, and what the rate box is restored from when the
-- invoice is reopened.
--
-- It has to be stored rather than read back off the lines. A new invoice has no
-- lines yet, so there would be nowhere to keep the rate typed before the first
-- line is added; and once one line is overridden, no single line is authoritative
-- about what the standard rate was.
--
-- Nullable, so every existing and every non-hourly invoice is untouched.
-- Run after 0047.
-- =============================================================================

alter table public.invoices
  add column if not exists hourly_rate numeric(12, 2);
