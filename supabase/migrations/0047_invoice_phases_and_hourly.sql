-- =============================================================================
-- Hartwell Pulse — 0047 invoice phases + hourly billing
--
-- Two optional, additive things. Every existing invoice and every future plain
-- one renders exactly as it did before. Run after 0046.
--
-- 1. PHASES. Line items may be grouped into named phases, e.g. a website build
--    sold as "Phase 1 — Design and build" then "Phase 2 — Launch and handover",
--    each closing with its own subtotal.
--
--    The phase lives ON the line rather than in its own table, deliberately.
--    Saving an invoice deletes every line and reinserts it (see saveInvoice), so
--    a separate phases table would need its own RLS, its own composite FK and
--    its own orphan cleanup for no gain: a phase with no lines has nothing to
--    bill and does not belong on an invoice anyway. Grouping is derived by
--    walking the lines in position order and starting a new group whenever
--    phase_position changes.
--
-- 2. HOURLY. An invoice may be billed by the hour rather than as a flat fee.
--    This changes presentation only, not the maths: quantity carries the hours
--    and unit_amount the hourly rate, exactly as they already carry quantity and
--    unit price, so amount = quantity * unit_amount either way. What it changes
--    is that the Qty/Unit columns are always shown and read "Hours" and
--    "Rate/hr" — on a flat-fee invoice those columns still auto-hide when every
--    quantity is 1, because Unit and Amount would just be the same figure twice.
-- =============================================================================

alter table public.invoice_line_items
  -- null = this line is not in a phase. Distinct value per group; lines sharing
  -- one are rendered together under a single heading.
  add column if not exists phase_position integer,
  -- Denormalised onto each line in the group. The builder writes the same value
  -- to every line of a phase when the heading is edited.
  add column if not exists phase_title text,
  -- Optional second line under the heading, e.g. "Payable on commencement".
  add column if not exists phase_note text;

alter table public.invoices
  add column if not exists rate_mode text not null default 'fixed';

-- Constrained rather than free text, so a typo cannot quietly land an invoice in
-- a mode nothing renders. Dropped first because Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS and this file has to stay re-runnable.
alter table public.invoices drop constraint if exists invoices_rate_mode_check;
alter table public.invoices
  add constraint invoices_rate_mode_check check (rate_mode in ('fixed', 'hourly'));
