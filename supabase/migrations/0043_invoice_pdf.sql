-- =============================================================================
-- 0043 — attach the invoice PDF to the email that says it is ready
--
-- Exactly what 0042 did for reports, and for the same reason: a client told
-- their invoice is ready and handed a portal link has a sign-in between them
-- and the thing they were sent. An invoice is worse than a report in that
-- respect, because it goes to whoever pays the bills, and that is often not
-- the person with the login. A bookkeeper cannot pay what they cannot open.
--
-- Two differences from the report version, both worth knowing.
--
-- FIRST, an invoice has no publish step. A report is written, published, then
-- sent, and 0042 hangs the render on publish. An invoice goes draft to sent in
-- one move, so the render happens on demand from the editor, and the send makes
-- one first if none exists.
--
-- SECOND, an invoice can be sent with nobody watching. The recurring cron
-- materialises and auto-sends. So the rule that a missing PDF stops a report
-- send is INVERTED here: an invoice that does not arrive is worse than one that
-- arrives without its attachment, so a failed render never blocks the money.
--
-- Run after 0042. Idempotent.
-- =============================================================================

alter table public.invoices
  -- Object path inside `pulse-reports`. The bucket is named for what it was
  -- built for rather than what it holds; renaming it would break every stored
  -- report path for no gain.
  add column if not exists pdf_path text,
  -- The filename the client sees. Stored rather than derived from the path,
  -- which carries a timestamp to stop collisions.
  add column if not exists pdf_name text,
  add column if not exists pdf_uploaded_at timestamptz;

-- A stale PDF matters more on an invoice than on a report. A sent invoice can
-- be corrected and reissued under the same number (0033), and `revision` bumps
-- when it is. An attachment made before that correction shows the old amount
-- or the old due date over the same invoice number, which is precisely the
-- silent change the reissue rules exist to prevent.
comment on column public.invoices.pdf_uploaded_at is
  'When the attached PDF was made. Older than updated_at means it predates the last edit, and on a reissued invoice that means it shows superseded figures under the same number. Regenerate before sending.';
