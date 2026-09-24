-- R-038 · The audit log (owner request): who did what and when — every change staff and the owner
-- make, and what customers and the system did — in one list the owner filters by kind of work.
-- Sources: deposit_events (copied as they are written, and the history so far), a trigger on
-- bookings, triggers on the settings tables, and the server for user management and LINE keys
-- (service-role writes, where the database cannot see who acted). The owner reads; no one edits.
-- branch_id and actor_id are plain uuids, not foreign keys: the log outlives deleted branches and
-- users, and a branch delete cascading to its tables must not fail on its own audit rows.

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  branch_id uuid,
  actor_id uuid,
  actor_name text,
  actor_kind text not null default 'staff' check (actor_kind in ('staff', 'customer', 'system')),
  category text not null check (category in ('deposit', 'withdrawal', 'booking', 'print', 'settings', 'users')),
  action text not null check (length(action) between 1 and 60),
  target text,
  target_id uuid,
  details jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_category_idx on public.audit_log (category, at desc);
create index if not exists audit_log_branch_idx on public.audit_log (branch_id, at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc) where actor_id is not null;

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated using ((select private.is_owner()));

-- ── writing ──────────────────────────────────────────────────────────────
-- one row as the signed-in person (or the system / a customer when no one is signed in)
create or replace function private.audit(p_branch uuid, p_category text, p_action text, p_target text, p_target_id uuid, p_details jsonb, p_kind text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_name text;
begin
  if v_actor is not null then
    select coalesce(nullif(p.display_name, ''), p.username) into v_name from public.profiles p where p.id = v_actor;
  end if;
  insert into public.audit_log (branch_id, actor_id, actor_name, actor_kind, category, action, target, target_id, details)
  values (p_branch, v_actor, v_name, coalesce(p_kind, case when v_actor is null then 'system' else 'staff' end),
    p_category, p_action, p_target, p_target_id, coalesce(p_details, '{}'::jsonb));
end $$;

-- {column: [old, new]} for the columns that changed, minus the ones in p_skip
create or replace function private.jsonb_changes(p_old jsonb, p_new jsonb, p_skip text[] default '{}')
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_array(p_old -> k, p_new -> k)), '{}'::jsonb)
  from (select jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) union select jsonb_object_keys(coalesce(p_new, '{}'::jsonb))) as keys (k)
  where not (k = any (p_skip)) and (p_old -> k) is distinct from (p_new -> k)
$$;

-- ── deposits and withdrawals: the event log they already keep ────────────
create or replace function private.deposit_event_category(p_action text)
returns text language sql immutable set search_path = '' as $$
  select case when p_action like 'withdrawal%' then 'withdrawal' when p_action = 'printed' then 'print' else 'deposit' end
$$;

create or replace function private.audit_deposit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_code text; v_item text; v_customer text; v_name text;
begin
  select d.code, d.item_name, d.customer_name into v_code, v_item, v_customer from public.deposits d where d.id = new.deposit_id;
  if new.actor_id is not null then
    select coalesce(nullif(p.display_name, ''), p.username) into v_name from public.profiles p where p.id = new.actor_id;
  end if;
  insert into public.audit_log (at, branch_id, actor_id, actor_name, actor_kind, category, action, target, target_id, details)
  values (new.created_at, new.branch_id, new.actor_id, v_name, new.actor_kind, private.deposit_event_category(new.action),
    'deposit.' || new.action, v_code, new.deposit_id,
    new.payload || jsonb_build_object('item', v_item, 'customer', v_customer));
  return null;
end $$;
drop trigger if exists deposit_events_audit on public.deposit_events;
create trigger deposit_events_audit after insert on public.deposit_events
  for each row execute function private.audit_deposit_event();

-- ── bookings: created, each status it reaches, its table, other edits ────
create or replace function private.audit_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_action text; v_kind text; v_det jsonb; t_old text; t_new text;
begin
  select t.label into t_new from public.tables t where t.id = new.table_id;
  if tg_op = 'INSERT' then
    v_action := 'booking.created';
    v_kind := case when auth.uid() is not null then 'staff' when new.source = 'line' then 'customer' else 'system' end;
    v_det := jsonb_build_object('table', t_new, 'status', new.status);
  else
    if new.status is distinct from old.status then
      v_action := 'booking.' || new.status;
    elsif new.table_id is distinct from old.table_id then
      v_action := 'booking.table';
    elsif (to_jsonb(new) - array['updated_at', 'reminder_sent_at']) is distinct from (to_jsonb(old) - array['updated_at', 'reminder_sent_at']) then
      v_action := 'booking.updated';
    else
      return null; -- only a reminder stamp: nothing a person would call a change
    end if;
    v_kind := case when auth.uid() is not null then 'staff'
                   when new.status = 'cancelled' and new.cancelled_by_customer then 'customer'
                   else 'system' end;
    select t.label into t_old from public.tables t where t.id = old.table_id;
    v_det := case when t_old is distinct from t_new then jsonb_build_object('table', jsonb_build_array(t_old, t_new)) else jsonb_build_object('table', t_new) end
      || case when new.status = 'cancelled' and new.status is distinct from old.status then jsonb_build_object('reason', new.cancel_reason)
              when new.status = 'rejected' and new.status is distinct from old.status then jsonb_build_object('reason', new.reject_reason)
              else '{}'::jsonb end
      || case when v_action = 'booking.updated' then private.jsonb_changes(to_jsonb(old), to_jsonb(new),
                array['id', 'branch_id', 'code', 'qr_token', 'created_at', 'updated_at', 'reminder_sent_at', 'table_id', 'status'])
              else '{}'::jsonb end;
  end if;
  v_det := v_det || jsonb_build_object('name', new.name, 'night', new.night, 'time', to_char(new.slot_time, 'HH24:MI'), 'party', new.party_size);
  perform private.audit(new.branch_id, 'booking', v_action, new.code, new.id, v_det, v_kind);
  return null;
end $$;
drop trigger if exists bookings_audit on public.bookings;
create trigger bookings_audit after insert or update on public.bookings
  for each row execute function private.audit_booking();

-- ── settings: the owner's tables, with what changed ──────────────────────
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
    v_det := private.jsonb_changes(o, n, v_skip || array['receipt_settings']);
    -- receipt settings are one json column: name the keys that changed inside it
    v_det := v_det || coalesce((select jsonb_object_agg('receipt_settings.' || c.key, c.value)
      from jsonb_each(private.jsonb_changes(o -> 'receipt_settings', n -> 'receipt_settings')) c), '{}'::jsonb);
    if v_det = '{}'::jsonb then return null; end if;
  else
    v_det := r - v_skip - 'receipt_settings';
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

drop trigger if exists booking_settings_audit on public.booking_settings;
create trigger booking_settings_audit after update on public.booking_settings for each row execute function private.audit_settings('booking_settings');
drop trigger if exists booking_blackouts_audit on public.booking_blackouts;
create trigger booking_blackouts_audit after insert or delete on public.booking_blackouts for each row execute function private.audit_settings('blackout');
drop trigger if exists table_zones_audit on public.table_zones;
create trigger table_zones_audit after insert or update or delete on public.table_zones for each row execute function private.audit_settings('zone');
drop trigger if exists tables_audit on public.tables;
create trigger tables_audit after insert or update or delete on public.tables for each row execute function private.audit_settings('table');
drop trigger if exists table_blocks_audit on public.table_blocks;
create trigger table_blocks_audit after insert or delete on public.table_blocks for each row execute function private.audit_settings('table_block');
drop trigger if exists liquor_items_audit on public.liquor_items;
create trigger liquor_items_audit after insert or update or delete on public.liquor_items for each row execute function private.audit_settings('item');
drop trigger if exists branches_audit on public.branches;
create trigger branches_audit after insert or update on public.branches for each row execute function private.audit_settings('branch');

-- ── the history so far ───────────────────────────────────────────────────
insert into public.audit_log (at, branch_id, actor_id, actor_name, actor_kind, category, action, target, target_id, details)
select e.created_at, e.branch_id, e.actor_id, coalesce(nullif(p.display_name, ''), p.username), e.actor_kind,
       private.deposit_event_category(e.action), 'deposit.' || e.action, d.code, e.deposit_id,
       e.payload || jsonb_build_object('item', d.item_name, 'customer', d.customer_name)
from public.deposit_events e
join public.deposits d on d.id = e.deposit_id
left join public.profiles p on p.id = e.actor_id
where not exists (select 1 from public.audit_log a where a.target_id = e.deposit_id and a.action = 'deposit.' || e.action and a.at = e.created_at);

-- bookings: from their own time stamps (who cancelled or rejected was never kept)
insert into public.audit_log (at, branch_id, actor_id, actor_name, actor_kind, category, action, target, target_id, details)
select x.at, b.branch_id, x.actor, coalesce(nullif(p.display_name, ''), p.username), x.kind, 'booking', x.action, b.code, b.id,
       jsonb_build_object('name', b.name, 'night', b.night, 'time', to_char(b.slot_time, 'HH24:MI'), 'party', b.party_size)
from public.bookings b
cross join lateral (values
  (b.created_at, 'booking.created', b.created_by, case when b.created_by is not null then 'staff' when b.source = 'line' then 'customer' else 'system' end),
  (b.confirmed_at, 'booking.confirmed', b.confirmed_by, case when b.confirmed_by is not null then 'staff' else 'system' end),
  (b.arrived_at, 'booking.arrived', b.checked_in_by, case when b.checked_in_by is not null then 'staff' else 'system' end),
  (b.cancelled_at, 'booking.cancelled', null::uuid, case when b.cancelled_by_customer then 'customer' else 'staff' end),
  (b.rejected_at, 'booking.rejected', null::uuid, 'staff'),
  (b.no_show_at, 'booking.no_show', null::uuid, 'system')
) as x (at, action, actor, kind)
left join public.profiles p on p.id = x.actor
where x.at is not null
  and not exists (select 1 from public.audit_log a where a.target_id = b.id and a.action = x.action);

-- ── reading: the owner's page ────────────────────────────────────────────
-- One page of rows for the filters, the total, and the count per kind of work (for the chips —
-- counted without the kind filter). p_actor: a person's id, 'customer' or 'system'.
create or replace function public.audit_feed(
  p_from timestamptz, p_to timestamptz, p_category text default null, p_branch uuid default null,
  p_actor text default null, p_q text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_like text;
  v_actor uuid := case when p_actor ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then p_actor::uuid end;
  v_out jsonb;
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  with f as (
    select a.* from public.audit_log a
    where a.at >= p_from and a.at < p_to
      and (p_branch is null or a.branch_id = p_branch)
      and (p_actor is null or (p_actor in ('customer', 'system') and a.actor_kind = p_actor) or a.actor_id = v_actor)
      and (v_like is null or a.target ilike v_like or a.actor_name ilike v_like
           or a.details ->> 'name' ilike v_like or a.details ->> 'customer' ilike v_like)
  ),
  k as (select * from f where p_category is null or f.category = p_category),
  page as (select * from k order by k.at desc, k.id desc limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0)))
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(c.category, c.n) from (select f.category, count(*) as n from f group by f.category) c), '{}'::jsonb),
    'total', (select count(*) from k),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.id, 'at', pg.at, 'branch_id', pg.branch_id, 'actor_id', pg.actor_id, 'actor_name', pg.actor_name,
        'actor_kind', pg.actor_kind, 'actor_role', pr.role, 'category', pg.category, 'action', pg.action,
        'target', pg.target, 'target_id', pg.target_id, 'details', pg.details) order by pg.at desc, pg.id desc)
      from page pg left join public.profiles pr on pr.id = pg.actor_id), '[]'::jsonb))
  into v_out;
  return v_out;
end $$;

revoke all on function private.audit(uuid, text, text, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function private.jsonb_changes(jsonb, jsonb, text[]) from public, anon, authenticated;
revoke all on function private.deposit_event_category(text) from public, anon, authenticated;
revoke all on function private.audit_deposit_event() from public, anon, authenticated;
revoke all on function private.audit_booking() from public, anon, authenticated;
revoke all on function private.audit_settings() from public, anon, authenticated;
revoke all on function public.audit_feed(timestamptz, timestamptz, text, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.audit_feed(timestamptz, timestamptz, text, uuid, text, text, integer, integer) to authenticated;
