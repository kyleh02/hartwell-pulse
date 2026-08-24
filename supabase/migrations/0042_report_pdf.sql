-- =============================================================================
-- 0042 — attach the PDF to the email that says the report is ready
--
-- The report email tells a client their report is ready and hands them a link
-- into the portal. That is one login between a person and the thing they were
-- promised, and for the client who forwards it to a business partner it is two.
-- So the PDF travels with the email.
--
-- The portal does NOT make the PDF. Kyle prints the report from the viewer,
-- which is what the print stylesheet and the {client} - {title} tab title
-- already exist for, and attaches the file here. That is deliberate rather
-- than a shortcut: a server-side renderer is a headless browser this stack has
-- nowhere to put, and it would produce a document nobody had looked at. The
-- attached file is the one Kyle actually opened and checked.
--
-- Storage lives in the existing private `pulse-reports` bucket, under the same
-- client_id-first path the images use, so the storage policies already cover
-- it and nothing new is world-readable.
--
-- Run after 0041. Idempotent.
-- =============================================================================

alter table public.reports
  -- Object path inside `pulse-reports`. Null means no PDF is attached, which
  -- is the normal state of a draft and a perfectly valid state of a send.
  add column if not exists pdf_path text,
  -- The filename the client sees on the attachment. Stored rather than derived
  -- from the path, because the path carries a uuid to stop collisions and
  -- "a7f3e2c1-report.pdf" is not a thing to send anyone.
  add column if not exists pdf_name text,
  add column if not exists pdf_uploaded_at timestamptz;

-- A PDF that predates the last edit is worse than none: it says the same thing
-- the report used to say, over the letterhead of the one it says now. Nothing
-- can detect that automatically, so the timestamp is kept to show alongside
-- the report's own updated_at and let a person see the two have diverged.
comment on column public.reports.pdf_uploaded_at is
  'When the attached PDF was uploaded. Compare against updated_at: a PDF older than the last edit is stale and should be replaced before sending.';
