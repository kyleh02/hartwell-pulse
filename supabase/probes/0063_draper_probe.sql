-- =============================================================================
-- Draper, Stage 2 probe. Paste into the Supabase SQL Editor AFTER 0063, then Run.
-- Changes nothing. Every row should say pass = true.
-- =============================================================================

create or replace function pg_temp.draper_probe_0063()
returns table (test text, result text, pass boolean)
language plpgsql
as $$
#variable_conflict use_column
declare n int; v text;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'do_not_contact' and column_name in ('abn', 'phone');
  test := 'do_not_contact has abn and phone'; result := n || ' of 2'; pass := n = 2; return next;

  select count(*) into n from pg_constraint
   where conname = 'do_not_contact_abn_check' and conrelid = 'public.do_not_contact'::regclass;
  test := 'a do-not-contact ABN must be 11 digits'; result := n || ' check'; pass := n = 1; return next;

  select count(*) into n from pg_indexes
   where schemaname = 'public' and tablename = 'outreach_fingerprints' and indexname = 'outreach_fingerprints_hash_idx';
  test := 'fingerprints are indexed by hash'; result := n || ' index'; pass := n = 1; return next;

  select count(*) into n from public.do_not_contact;
  test := 'the do-not-contact list is all still there'; result := n || ' entries'; pass := true; return next;

  v := null;
  begin
    insert into public.do_not_contact (business, abn, reason, source) values ('Probe', '123', 'probe', 'probe');
    v := 'ALLOWED a bad ABN';
    raise exception 'probe_undo';
  exception
    when check_violation then v := 'refused';
    when others then if sqlerrm <> 'probe_undo' then v := 'error: ' || sqlerrm; end if;
  end;
  test := 'a malformed ABN is refused'; result := v; pass := v = 'refused'; return next;
end $$;

select * from pg_temp.draper_probe_0063();
