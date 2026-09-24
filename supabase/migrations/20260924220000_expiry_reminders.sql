-- R-044 · Expiry reminders the owner shapes (owner request): an on/off switch for the branch and
-- for each customer, the time of day they go out, up to three reminders (e.g. 15 · 7 · 3 days
-- before) and the wording in every LIFF language, with {{day}} and friends.
--
-- · branches.expiry_reminders_enabled / expiry_reminder_days (1–3 of 1..90) / expiry_reminder_time
--   (Bangkok wall clock) / expiry_reminder_templates ({th,en,zh,ko} → text; a missing language
--   uses the default wording, messages/customer/*.json line.expiryReminder).
-- · customers.expiry_notices_enabled — one person, every branch.
-- · deposits.expiry_reminders_sent — the reminder days already handled for the current expiry
--   date; a new date (extend, VIP off) starts over.
-- · run_expiry_notices(): pinged every 5 minutes; each branch runs once a day, at or after its time.
--   One message per deposit per run however many reminder days are due (a late link, a short
--   term). "หมดอายุแล้ว" now leaves at the same time, not at the hour the deposit expired (04:00).
--   Switched off (branch or customer), due reminders are dropped, not saved up.
-- · expiry_notice_days stays: it is the staff's "ใกล้หมดอายุ" window (คืนนี้, ภาพรวม).

-- ── settings ─────────────────────────────────────────────────────────────
alter table public.branches
  add column if not exists expiry_reminders_enabled boolean not null default true,
  add column if not exists expiry_reminder_days integer[] not null default '{7}',
  add column if not exists expiry_reminder_time time not null default '12:00',
  add column if not exists expiry_reminder_templates jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'branches_expiry_reminder_days_check') then
    alter table public.branches add constraint branches_expiry_reminder_days_check check (
      cardinality(expiry_reminder_days) between 1 and 3
      and array_position(expiry_reminder_days, null) is null
      and 1 <= all (expiry_reminder_days) and 90 >= all (expiry_reminder_days));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'branches_expiry_reminder_templates_check') then
    alter table public.branches add constraint branches_expiry_reminder_templates_check check (
      jsonb_typeof(expiry_reminder_templates) = 'object' and length(expiry_reminder_templates::text) <= 8000);
  end if;
end $$;

-- the one notice day so far becomes the first reminder
update public.branches set expiry_reminder_days = array[greatest(1, least(90, expiry_notice_days))]
where expiry_reminder_days = '{7}' and expiry_notice_days <> 7;

alter table public.customers add column if not exists expiry_notices_enabled boolean not null default true;

alter table public.deposits add column if not exists expiry_reminders_sent integer[] not null default '{}';

-- a notice already sent under the one-day rule counts as that reminder
update public.deposits d set expiry_reminders_sent = array[greatest(1, least(90, b.expiry_notice_days))]
from public.branches b
where b.id = d.branch_id and d.expiry_notice_sent_at is not null and d.expiry_reminders_sent = '{}';

-- a new expiry date starts the reminders over
create or replace function private.reset_expiry_reminders()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.expiry_reminders_sent := '{}';
  return new;
end $$;
revoke all on function private.reset_expiry_reminders() from public, anon, authenticated;

create or replace trigger deposits_reset_expiry_reminders before update of expires_at on public.deposits
  for each row when (old.expires_at is distinct from new.expires_at) execute function private.reset_expiry_reminders();

-- the day each branch last ran (service only)
create table if not exists private.expiry_notice_runs (
  branch_id uuid primary key references public.branches (id) on delete cascade,
  ran_on date not null
);
alter table private.expiry_notice_runs enable row level security;
revoke all on private.expiry_notice_runs from public, anon, authenticated;

-- ── the run ──────────────────────────────────────────────────────────────
-- p_branch / p_force are for the specs: one branch, ignoring its time and the day already run
create or replace function public.run_expiry_notices(p_branch uuid default null, p_force boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Bangkok')::date;
  now_t time := (now() at time zone 'Asia/Bangkok')::time;
  b record;
  d record;
  claimed integer;
  due integer[];
  left_days integer;
  tpl text;
  send boolean;
  n integer := 0;
begin
  if not (private.is_service() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  for b in
    select br.id, br.expiry_reminders_enabled, br.expiry_reminder_days, br.expiry_reminder_templates
    from public.branches br
    where br.active and (p_branch is null or br.id = p_branch)
      and (p_force or now_t >= br.expiry_reminder_time)
  loop
    -- once a day: the first run at or after the branch's time claims the day
    if not p_force then
      claimed := null;
      insert into private.expiry_notice_runs as r (branch_id, ran_on) values (b.id, today)
      on conflict (branch_id) do update set ran_on = excluded.ran_on where r.ran_on < excluded.ran_on
      returning 1 into claimed;
      continue when claimed is null;
    end if;

    -- reminders: one message per deposit, however many of its reminder days are due
    for d in
      select dep.id, dep.expires_at, dep.expiry_reminders_sent, c.locale::text as locale, c.expiry_notices_enabled
      from public.deposits dep
      join public.customers c on c.id = dep.customer_id
      where dep.branch_id = b.id and dep.status in ('in_store', 'pending_withdrawal')
        and not dep.is_vip and dep.expires_at is not null
    loop
      left_days := (d.expires_at at time zone 'Asia/Bangkok')::date - today;
      continue when left_days < 1;
      select coalesce(array_agg(s.x order by s.x desc), '{}') into due
      from (select distinct x from unnest(b.expiry_reminder_days) as u (x)) s
      where left_days <= s.x and not (s.x = any (d.expiry_reminders_sent));
      continue when cardinality(due) = 0;
      send := b.expiry_reminders_enabled and d.expiry_notices_enabled;
      update public.deposits
      set expiry_reminders_sent = expiry_reminders_sent || due,
          expiry_notice_sent_at = case when send then now() else expiry_notice_sent_at end
      where id = d.id;
      if send then
        tpl := nullif(btrim(b.expiry_reminder_templates ->> coalesce(d.locale, 'th')), '');
        perform private.notify_customer(d.id, 'expiry_soon',
          jsonb_build_object('days', left_days)
            || case when tpl is null then '{}'::jsonb else jsonb_build_object('template', tpl) end,
          'expiry_soon:' || d.id || ':' || to_char(d.expires_at at time zone 'Asia/Bangkok', 'YYYYMMDD') || ':' || due[cardinality(due)]);
        n := n + 1;
      end if;
    end loop;

    -- expired since the last runs (two days back at most — nothing stale after a switch-off)
    for d in
      select dep.id, c.expiry_notices_enabled
      from public.deposits dep
      join public.customers c on c.id = dep.customer_id
      where dep.branch_id = b.id and dep.status = 'expired' and dep.expired_notice_sent_at is null
        and dep.collect_deadline_at > now() - interval '2 days'
    loop
      if b.expiry_reminders_enabled and d.expiry_notices_enabled then
        update public.deposits set expired_notice_sent_at = now() where id = d.id;
        perform private.notify_customer(d.id, 'expired', '{}'::jsonb, 'expired:' || d.id);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.run_expiry_notices(uuid, boolean) from public, anon, authenticated;
grant execute on function public.run_expiry_notices(uuid, boolean) to service_role;

-- the cron entry point keeps its name
create or replace function public.send_expiry_notices()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_service() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return public.run_expiry_notices(null, false);
end $$;

-- in_store past the collection deadline → expired; the message now waits for the branch's time
create or replace function public.expire_due_deposits()
returns integer language plpgsql security definer set search_path = '' as $$
declare d record; n int := 0;
begin
  if not (private.is_service() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  for d in
    update public.deposits set status = 'expired'
    where status = 'in_store' and not is_vip and collect_deadline_at is not null and collect_deadline_at <= now()
    returning id, branch_id
  loop
    n := n + 1;
    insert into public.deposit_events (deposit_id, branch_id, actor_kind, action) values (d.id, d.branch_id, 'system', 'expired');
  end loop;
  return n;
end $$;

do $$ begin
  perform cron.unschedule('sis-expiry-notices') where exists (select 1 from cron.job where jobname = 'sis-expiry-notices');
end $$;
select cron.schedule('sis-expiry-notices', '*/5 * * * *', 'select public.send_expiry_notices()');

-- ── one customer on or off (bar / owner, from a deposit of theirs) ──────
create or replace function public.set_customer_expiry_notices(p_deposit uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; c public.customers%rowtype;
begin
  if p_enabled is null then raise exception 'invalid' using errcode = '22023'; end if;
  select * into d from public.deposits where id = p_deposit;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
  if d.customer_id is null then raise exception 'NOT_LINKED' using errcode = '22023'; end if;
  select * into c from public.customers where id = d.customer_id for update;
  if c.expiry_notices_enabled is distinct from p_enabled then
    update public.customers set expiry_notices_enabled = p_enabled where id = c.id;
    perform private.audit(d.branch_id, 'settings',
      case when p_enabled then 'customer.reminders_on' else 'customer.reminders_off' end,
      coalesce(nullif(c.display_name, ''), d.customer_name), c.id,
      jsonb_build_object('expiry_notices_enabled', jsonb_build_array(c.expiry_notices_enabled, p_enabled), 'deposit', d.code), null);
  end if;
  return jsonb_build_object('customer_id', c.id, 'enabled', p_enabled);
end $$;
revoke all on function public.set_customer_expiry_notices(uuid, boolean) from public, anon;
grant execute on function public.set_customer_expiry_notices(uuid, boolean) to authenticated;

-- ── the audit log names each language of the wording, like the receipt settings ──
create or replace function private.audit_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entity text := tg_argv[0];
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  v_branch uuid;
  v_verb text := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  v_skip text[] := array['id', 'branch_id', 'created_at', 'updated_at', 'created_by'];
  v_det jsonb;
  v_target text;
begin
  v_branch := case when v_entity = 'branch' then (r ->> 'id')::uuid else (r ->> 'branch_id')::uuid end;
  if tg_op = 'UPDATE' then
    v_det := private.jsonb_changes(o, n, v_skip || array['receipt_settings', 'expiry_reminder_templates']);
    -- receipt settings and the reminder wording are json columns: name the keys that changed inside
    v_det := v_det || coalesce((select jsonb_object_agg('receipt_settings.' || c.key, c.value)
      from jsonb_each(private.jsonb_changes(o -> 'receipt_settings', n -> 'receipt_settings')) c), '{}'::jsonb);
    v_det := v_det || coalesce((select jsonb_object_agg('expiry_reminder_templates.' || c.key, c.value)
      from jsonb_each(private.jsonb_changes(o -> 'expiry_reminder_templates', n -> 'expiry_reminder_templates')) c), '{}'::jsonb);
    if v_det = '{}'::jsonb then return null; end if;
  else
    v_det := r - v_skip - 'receipt_settings' - 'expiry_reminder_templates';
  end if;
  -- ids a person cannot read, by name
  if v_det ? 'zone_id' then
    v_det := (v_det - 'zone_id') || jsonb_build_object('zone', case when jsonb_typeof(v_det -> 'zone_id') = 'array' then
      jsonb_build_array((select z.name from public.table_zones z where z.id = (v_det -> 'zone_id' ->> 0)::uuid),
                        (select z.name from public.table_zones z where z.id = (v_det -> 'zone_id' ->> 1)::uuid))
      else to_jsonb((select z.name from public.table_zones z where z.id = (v_det ->> 'zone_id')::uuid)) end);
  end if;
  v_target := case v_entity
    when 'booking_settings' then (select b.name from public.branches b where b.id = v_branch)
    when 'blackout' then r ->> 'night'
    when 'zone' then r ->> 'name'
    when 'table' then r ->> 'label'
    when 'table_block' then concat_ws(' · ', (select t.label from public.tables t where t.id = (r ->> 'table_id')::uuid), r ->> 'night')
    when 'item' then r ->> 'name'
    when 'branch' then concat(r ->> 'name', ' (', r ->> 'code', ')')
  end;
  v_det := v_det - 'table_id';
  perform private.audit(v_branch, 'settings', v_entity || '.' || v_verb, v_target, coalesce((r ->> 'id')::uuid, v_branch), v_det, null);
  return null;
end $$;
