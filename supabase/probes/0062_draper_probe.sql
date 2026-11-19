-- =============================================================================
-- Draper, Stage 1 probe. Paste into the Supabase SQL Editor AFTER 0062, then Run.
--
-- It changes nothing. Each test writes inside a block that is undone before
-- the next test starts, and the function below is temporary (pg_temp): it is
-- gone when the editor's session ends.
--
-- Every row should say pass = true. If any says false, send Claude that row.
--
-- What it proves:
--   * the migration landed: every table is there with row-level security on;
--   * version 1 is safe: master switch off, test mode on, lane 1 active, no
--     defence lane;
--   * a signed-out visitor can't read anything, a client account sees and adds
--     nothing, an admin reads it all, and nobody's browser reads the Gmail
--     token table;
--   * a fingerprint can't be deleted, changed or truncated, even from here;
--   * a recorded settings version can't be changed; the slider can't go past
--     25; lane 4 can't be added;
--   * a business can't get a second first email, and a real sent email can't
--     be deleted.
-- =============================================================================

create or replace function pg_temp.draper_probe()
returns table (test text, result text, pass boolean)
language plpgsql
as $$
#variable_conflict use_column
declare
  t text;
  n bigint;
  k bigint;
  v text;
  ok boolean;
  pid uuid;
  admin_sub text;
  client_sub text;
  tables text[] := array[
    'outreach_templates', 'outreach_run_instructions', 'outreach_lessons', 'outreach_settings',
    'outreach_lanes', 'outreach_state', 'outreach_prospects', 'outreach_contacts',
    'outreach_measurements', 'outreach_messages', 'outreach_claims', 'outreach_replies',
    'outreach_events', 'outreach_fingerprints', 'outreach_exclusions', 'outreach_client_areas',
    'outreach_tests', 'outreach_change_log', 'outreach_postcodes', 'outreach_holidays',
    'outreach_gmail'
  ];
begin
  -- ---------- 1. the migration landed ----------
  foreach t in array tables loop
    select case when c.oid is null then 'missing'
                when c.relrowsecurity then 'there, RLS on'
                else 'there, RLS OFF' end,
           coalesce(c.relrowsecurity, false)
      into result, pass
      from (select 1) one
      left join pg_class c
        on c.relname = t and c.relnamespace = 'public'::regnamespace and c.relkind = 'r';
    test := 'table ' || t;
    return next;
  end loop;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename like 'outreach\_%'
     and (coalesce(qual, '') || coalesce(with_check, '')) not like '%is_admin()%';
  test := 'every Draper policy goes through is_admin()';
  result := n || ' that do not'; pass := n = 0; return next;

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'outreach\_%'
     and (grantee in ('anon', 'PUBLIC') or (grantee = 'authenticated' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')));
  test := 'no grants to signed-out visitors, and no TRUNCATE for anyone signed in';
  result := n || ' such grants'; pass := n = 0; return next;

  -- ---------- 2. version 1 is in place, and safe ----------
  select string_agg(id::text, ', ' order by id) into v from public.outreach_lanes;
  test := 'lanes 1, 2, 3 and 5, no defence lane';
  result := coalesce(v, 'none'); pass := v = '1, 2, 3, 5'; return next;

  select string_agg(id::text, ', ') into v from public.outreach_lanes where active;
  test := 'one active lane: lane 1';
  result := coalesce(v, 'none'); pass := v = '1'; return next;

  v := null; ok := false;
  select format('master %s, test mode %s, %s first emails a day',
                case when s.master_on then 'ON' else 'off' end,
                case when s.test_mode then 'on' else 'OFF' end,
                s.daily_first_emails),
         not s.master_on and s.test_mode
    into v, ok
    from public.outreach_settings s where s.version = 1;
  test := 'settings v1: master switch off, test mode on';
  result := coalesce(v, 'missing'); pass := coalesce(ok, false); return next;

  select count(*) into n from public.outreach_templates where version = 1;
  select count(*) into k from public.outreach_run_instructions where version = 1;
  test := 'template v1 and run instructions v1';
  result := format('template %s, run instructions %s', n, k); pass := n = 1 and k = 1; return next;

  select count(*) into n from public.outreach_state where not paused;
  test := 'the one state row, not paused';
  result := n || ' row'; pass := n = 1; return next;

  -- ---------- 3. who can read ----------
  select clerk_user_id into admin_sub from public.client_users where role = 'admin' limit 1;
  select clerk_user_id into client_sub from public.client_users where role = 'client' limit 1;

  -- A signed-out visitor.
  v := null;
  begin
    set local role anon;
    perform 1 from public.outreach_lanes limit 1;
    v := 'READ the lanes';
    raise exception 'probe_undo';
  exception
    when insufficient_privilege then v := 'refused';
    when others then if sqlerrm <> 'probe_undo' then v := 'error: ' || sqlerrm; end if;
  end;
  test := 'a signed-out visitor reads nothing';
  result := v; pass := v = 'refused'; return next;

  -- A client account: every table looks empty, and it can't add a row.
  v := null; n := 0;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', coalesce(client_sub, 'probe-not-a-user'), 'role', 'authenticated')::text, true);
    foreach t in array tables loop
      continue when t = 'outreach_gmail';
      execute format('select count(*) from public.%I', t) into k;
      n := n + k;
    end loop;
    v := n || ' rows visible';
    begin
      insert into public.outreach_exclusions (business_name, note) values ('Probe Pty Ltd', 'probe');
      v := v || ', ADDED an exclusion';
    exception when insufficient_privilege then v := v || ', add refused';
    end;
    raise exception 'probe_undo';
  exception when others then
    if sqlerrm <> 'probe_undo' then v := 'error: ' || sqlerrm; end if;
  end;
  test := 'a client account sees and adds nothing'
    || case when client_sub is null then ' (no client account found, so a made-up signed-in user)' else '' end;
  result := v; pass := v = '0 rows visible, add refused'; return next;

  -- An admin: reads everything, except the Gmail token table, which no
  -- browser can read.
  v := null; ok := false;
  if admin_sub is null then
    v := 'no admin account found in client_users';
  else
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims',
        json_build_object('sub', admin_sub, 'role', 'authenticated')::text, true);
      select count(*) into n from public.outreach_lanes;
      v := 'lanes ' || n; ok := n >= 4;
      select count(*) into n from public.outreach_settings;
      v := v || ', settings ' || n; ok := ok and n >= 1;
      select count(*) into n from public.outreach_templates;
      v := v || ', templates ' || n; ok := ok and n >= 1;
      select count(*) into n from public.outreach_run_instructions;
      v := v || ', run instructions ' || n; ok := ok and n >= 1;
      select count(*) into n from public.outreach_state;
      v := v || ', state ' || n; ok := ok and n = 1;
      begin
        perform 1 from public.outreach_gmail limit 1;
        v := v || ', READ the Gmail table'; ok := false;
      exception when insufficient_privilege then v := v || ', Gmail table refused';
      end;
      raise exception 'probe_undo';
    exception when others then
      if sqlerrm <> 'probe_undo' then v := 'error: ' || sqlerrm; ok := false; end if;
    end;
  end if;
  test := 'an admin reads everything (not the Gmail token table)';
  result := v; pass := ok; return next;

  -- ---------- 4. permanent records ----------
  v := null;
  begin
    insert into public.outreach_fingerprints (kind, hash, reason, source)
    values ('domain', repeat('0', 64), 'imported', 'probe');
    begin
      delete from public.outreach_fingerprints where source = 'probe';
      v := 'DELETED';
    exception when restrict_violation then v := 'delete refused';
    end;
    begin
      update public.outreach_fingerprints set reason = 'contacted' where source = 'probe';
      v := v || ', CHANGED';
    exception when restrict_violation then v := v || ', change refused';
    end;
    begin
      truncate public.outreach_fingerprints;
      v := v || ', TRUNCATED';
    exception when restrict_violation then v := v || ', truncate refused';
    end;
    raise exception 'probe_undo';
  exception when others then
    if sqlerrm <> 'probe_undo' then v := 'error: ' || sqlerrm; end if;
  end;
  test := 'a fingerprint can never be deleted, changed or truncated, even from here';
  result := v; pass := v = 'delete refused, change refused, truncate refused'; return next;

  v := null;
  begin
    update public.outreach_settings set master_on = true where version = 1;
    v := 'CHANGED';
    raise exception 'probe_undo';
  exception
    when restrict_violation then v := 'refused';
    when others then if sqlerrm <> 'probe_undo' then v := 'error: ' || sqlerrm; end if;
  end;
  test := 'a recorded settings version cannot be changed';
  result := v; pass := v = 'refused'; return next;

  -- ---------- 5. limits the database holds ----------
  v := null;
  begin
    insert into public.outreach_settings (version, daily_first_emails) values (2147483000, 26);
    v := 'ALLOWED 26';
    raise exception 'probe_undo';
  exception
    when check_violation then v := 'refused';
    when others then if sqlerrm <> 'probe_undo' then v := 'error: ' || sqlerrm; end if;
  end;
  test := 'the daily slider cannot be set past 25';
  result := v; pass := v = 'refused'; return next;

  v := null;
  begin
    insert into public.outreach_lanes (id, name) values (4, 'Defence industry');
    v := 'ALLOWED lane 4';
    raise exception 'probe_undo';
  exception
    when check_violation then v := 'refused';
    when others then if sqlerrm <> 'probe_undo' then v := 'error: ' || sqlerrm; end if;
  end;
  test := 'the defence lane cannot be added';
  result := v; pass := v = 'refused'; return next;

  v := null;
  begin
    insert into public.outreach_prospects (business_name, domain)
    values ('Probe Pty Ltd', 'probe.invalid') returning id into pid;
    insert into public.outreach_messages
      (prospect_id, kind, subject, body, template_version, status, sent_at, test_mode, sent_to, queued_at)
    values (pid, 'first', 'probe', 'probe', 1, 'sent', now(), false, 'probe@probe.invalid', now());
    begin
      insert into public.outreach_messages (prospect_id, kind, subject, body, template_version)
      values (pid, 'first', 'probe', 'probe', 1);
      v := 'SECOND first email allowed';
    exception when unique_violation then v := 'second first email refused';
    end;
    begin
      delete from public.outreach_prospects where id = pid;
      v := v || ', sent email DELETED';
    exception when restrict_violation then v := v || ', sent email kept';
    end;
    raise exception 'probe_undo';
  exception when others then
    if sqlerrm <> 'probe_undo' then v := 'error: ' || sqlerrm; end if;
  end;
  test := 'one first email per business, and a real sent email is never deleted';
  result := v; pass := v = 'second first email refused, sent email kept'; return next;
end $$;

select * from pg_temp.draper_probe();
