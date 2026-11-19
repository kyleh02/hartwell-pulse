-- =============================================================================
-- 0063: Draper, Stage 2. The no-repeat rule's two schema pieces.
--
-- 1. do_not_contact works by business, not only by address. It gains an ABN
--    and a phone number. The matching itself is in the portal's code
--    (src/lib/outreach/normalise.ts and match.ts): an entry blocks every
--    business sharing its email, its email's domain (unless it is webmail),
--    its website's domain, its business name, its ABN or its phone. So a
--    "no" from one address at a business covers the whole business.
--
-- 2. Fingerprints are looked up by hash, so the hash gets an index of its own
--    (0062's unique index leads with the kind).
--
-- Nothing is dropped or rewritten. Safe to run more than once.
-- =============================================================================

alter table public.do_not_contact
  add column if not exists abn text,
  add column if not exists phone text;

alter table public.do_not_contact drop constraint if exists do_not_contact_abn_check;
alter table public.do_not_contact add constraint do_not_contact_abn_check
  check (abn is null or abn ~ '^[0-9]{11}$');

create index if not exists outreach_fingerprints_hash_idx
  on public.outreach_fingerprints (hash);

notify pgrst, 'reload schema';
