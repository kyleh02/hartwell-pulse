-- Compose into Outlook instead of sending through Graph.
--
-- Four sends through Graph, four rejections with 550 5.7.708, to four
-- unrelated recipient domains. Every message sent by hand from Outlook in the
-- same window delivered, including one to a cold prospect sitting between two
-- of the failures. Restricted entities was empty and SPF, DKIM and DMARC are
-- all correct, so it is neither an account block nor authentication.
--
-- The remaining difference is the submission path. Exchange Online scores
-- programmatically-submitted mail differently, and anything that trips the
-- outbound spam filter is routed through the high-risk delivery pool, whose
-- IPs receiving servers reject with exactly that code. Cold, templated, plain
-- text, sent in sequence by an application is close to a textbook trigger.
--
-- So the portal stops being the thing that sends. It writes the email,
-- schedules it, runs the checks, and puts a finished draft in Kyle's Drafts
-- folder. He presses send, and it leaves on the interactive path that has
-- never failed once.
--
-- What that costs: sending while he is asleep. What it keeps: the emails in
-- one place, the schedule, the nine checks, the compliance log, and a delivery
-- path that actually reaches people. Given four out of four, that is not a
-- close call.
--
-- THE TOUCH IS STILL LOGGED ON SEND, NEVER ON DRAFT. A draft is not a send,
-- and the touch log is the Spam Act record. Logging at draft time would record
-- messages that never left, which is the exact failure just discovered.
--
-- Run after 0038. Idempotent.

alter table public.crm_organisations
  -- When a finished draft was placed in the mailbox.
  add column if not exists draft_created_at timestamptz,
  -- Deep link to the draft, so the portal can hand him straight to it.
  add column if not exists graph_web_link text;

create index if not exists crm_org_draft_idx
  on public.crm_organisations (brand, draft_created_at)
  where draft_created_at is not null;
