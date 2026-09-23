-- P1-03 · Bookings: zones, tables, per-branch booking settings, blackout nights, bookings,
-- and every booking rule enforced inside create_booking (never trusted from the client).

do $$ begin
  create type public.booking_status as enum ('pending', 'confirmed', 'arrived', 'no_show', 'cancelled', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.booking_source as enum ('line', 'staff');
exception when duplicate_object then null; end $$;

-- ── zones + tables (the floor plan) ──────────────────────────────────────
create table if not exists public.table_zones (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  sort integer not null default 0,
  customer_bookable boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists table_zones_branch_idx on public.table_zones (branch_id, sort);
create trigger table_zones_touch before update on public.table_zones for each row execute function private.touch_updated_at();

create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  zone_id uuid not null references public.table_zones (id) on delete cascade,
  label text not null check (label ~ '^[A-Za-z0-9ก-๙ ._-]{1,12}$'),
  shape text not null default 'square' check (shape in ('square', 'round', 'room')),
  seats_min integer not null default 1 check (seats_min between 1 and 100),
  seats_max integer not null default 4 check (seats_max between 1 and 100),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tables_seats_order check (seats_min <= seats_max),
  unique (branch_id, label)
);
create index if not exists tables_zone_idx on public.tables (zone_id, sort);
create trigger tables_touch before update on public.tables for each row execute function private.touch_updated_at();

-- a table's zone must be in the table's branch
create or replace function private.guard_table_zone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.table_zones z where z.id = new.zone_id and z.branch_id = new.branch_id) then
    raise exception 'ZONE_OTHER_BRANCH' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger tables_zone_guard before insert or update of zone_id, branch_id on public.tables
  for each row execute function private.guard_table_zone();

-- ── booking settings (one row per branch) ────────────────────────────────
create table if not exists public.booking_settings (
  branch_id uuid primary key references public.branches (id) on delete cascade,
  line_enabled boolean not null default true,
  auto_confirm boolean not null default false,
  advance_days integer not null default 14 check (advance_days between 0 and 120),
  cutoff_time time not null default '18:00',
  slot_start time not null default '19:00',
  slot_end time not null default '23:00',
  slot_minutes integer not null default 30 check (slot_minutes in (15, 20, 30, 45, 60, 90, 120)),
  max_bookings_per_night integer check (max_bookings_per_night is null or max_bookings_per_night between 1 and 500),
  party_min integer not null default 1 check (party_min between 1 and 100),
  party_max integer not null default 12 check (party_max between 1 and 200),
  no_show_minutes integer not null default 30 check (no_show_minutes between 5 and 240),
  customer_cancel_hours integer not null default 2 check (customer_cancel_hours between 0 and 72),
  -- Monday = 0 … Sunday = 6 (same as src/lib/date.ts weekdayIndex)
  closed_weekdays integer[] not null default '{}' check (closed_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]),
  updated_at timestamptz not null default now(),
  constraint booking_settings_party check (party_min <= party_max)
);
create trigger booking_settings_touch before update on public.booking_settings for each row execute function private.touch_updated_at();

create or replace function private.create_booking_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_settings (branch_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger branches_booking_settings after insert on public.branches
  for each row execute function private.create_booking_settings();
insert into public.booking_settings (branch_id) select id from public.branches on conflict do nothing;

create table if not exists public.booking_blackouts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  night date not null,
  reason text check (reason is null or length(reason) <= 200),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (branch_id, night)
);

-- ── bookings ─────────────────────────────────────────────────────────────
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  code text not null check (code ~ '^BK-[0-9]{4}-[0-9]{3}$'),
  night date not null,
  slot_time time not null,
  party_size integer not null check (party_size between 1 and 200),
  zone_id uuid references public.table_zones (id) on delete set null,
  table_id uuid references public.tables (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 120),
  phone text check (phone is null or phone ~ '^[0-9+\- ]{6,20}$'),
  note text check (note is null or length(note) <= 300),
  source public.booking_source not null,
  status public.booking_status not null,
  qr_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  created_by uuid references public.profiles (id),
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  rejected_at timestamptz,
  reject_reason text,
  arrived_at timestamptz,
  checked_in_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text,
  cancelled_by_customer boolean not null default false,
  no_show_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, code)
);
create index if not exists bookings_branch_night_idx on public.bookings (branch_id, night, status);
create index if not exists bookings_customer_idx on public.bookings (customer_id) where customer_id is not null;
create index if not exists bookings_due_idx on public.bookings (night) where status in ('pending', 'confirmed');
-- one live booking per table per night
create unique index if not exists bookings_table_night_uniq on public.bookings (table_id, night)
  where table_id is not null and status in ('pending', 'confirmed', 'arrived');
create trigger bookings_touch before update on public.bookings for each row execute function private.touch_updated_at();

-- ── helpers ──────────────────────────────────────────────────────────────
-- the instant a slot starts: times before slot_start belong after midnight (19:00–01:00 wraps)
create or replace function private.slot_instant(p_night date, p_slot time, p_start time)
returns timestamptz language sql immutable set search_path = '' as $$
  select ((p_night + case when p_slot < p_start then 1 else 0 end) + p_slot) at time zone 'Asia/Bangkok'
$$;

create or replace function private.slots(s public.booking_settings)
returns setof time language sql immutable set search_path = '' as $$
  select (s.slot_start + make_interval(mins => g * s.slot_minutes))::time
  from generate_series(0, 96) g
  where g * s.slot_minutes <= (
    extract(epoch from (s.slot_end - s.slot_start)) / 60
    + case when s.slot_end < s.slot_start then 1440 else 0 end)
$$;

create or replace function private.live_bookings(p_branch uuid, p_night date)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.bookings
  where branch_id = p_branch and night = p_night and status in ('pending', 'confirmed', 'arrived')
$$;

create or replace function private.notify_booking(p_booking uuid, p_kind text, p_extra jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; c public.customers%rowtype;
begin
  select * into b from public.bookings where id = p_booking;
  if b.customer_id is null then return; end if;
  select * into c from public.customers where id = b.customer_id;
  perform private.enqueue_line(b.branch_id, 'user', c.line_user_id, p_kind, c.locale,
    jsonb_build_object('booking_id', b.id, 'code', b.code, 'night', b.night, 'time', to_char(b.slot_time, 'HH24:MI'),
      'party', b.party_size, 'qr_token', b.qr_token) || coalesce(p_extra, '{}'::jsonb), p_dedupe);
end $$;

create or replace function private.table_free(p_table uuid, p_night date, p_except uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.bookings
    where table_id = p_table and night = p_night and status in ('pending', 'confirmed', 'arrived') and id <> coalesce(p_except, '00000000-0000-0000-0000-000000000000'))
$$;

-- ════════════════════════════════════════════════════════════════════════
-- RPCs
-- ════════════════════════════════════════════════════════════════════════

-- A customer (service role, after LINE verification, source line) or a staff member
-- (authenticated, source staff). Rule order is the error the customer sees first.
create or replace function public.create_booking(
  p_branch uuid, p_night date, p_slot time, p_party integer, p_name text,
  p_phone text default null, p_zone uuid default null, p_note text default null,
  p_customer_id uuid default null, p_table uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.booking_settings%rowtype;
  src public.booking_source;
  today date := private.business_night(now());
  bkk_now time := (now() at time zone 'Asia/Bangkok')::time;
  seq int;
  new_code text;
  st public.booking_status;
  new_id uuid;
  token text;
  z public.table_zones%rowtype;
begin
  if private.is_service() then
    src := 'line';
    if p_customer_id is null then raise exception 'CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    if p_table is not null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  else
    perform private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
    src := 'staff';
  end if;
  select * into s from public.booking_settings where branch_id = p_branch;
  if not found or not exists (select 1 from public.branches where id = p_branch and active) then
    raise exception 'BRANCH_INACTIVE' using errcode = '22023';
  end if;

  if src = 'line' and not s.line_enabled then raise exception 'line_disabled' using errcode = '22023'; end if;
  if p_night is null or p_night < today then raise exception 'past' using errcode = '22023'; end if;
  if (extract(isodow from p_night)::int - 1) = any (s.closed_weekdays) then raise exception 'closed_weekday' using errcode = '22023'; end if;
  if exists (select 1 from public.booking_blackouts where branch_id = p_branch and night = p_night) then
    raise exception 'blackout' using errcode = '22023';
  end if;
  if src = 'line' and p_night > today + s.advance_days then raise exception 'too_far' using errcode = '22023'; end if;
  if src = 'line' and p_night = today and bkk_now >= s.cutoff_time and bkk_now >= time '06:00' then
    raise exception 'cutoff' using errcode = '22023';
  end if;
  if p_slot is null or not exists (select 1 from private.slots(s) t where t = p_slot) then
    raise exception 'bad_slot' using errcode = '22023';
  end if;
  if p_party is null or p_party < s.party_min or p_party > s.party_max then raise exception 'party_size' using errcode = '22023'; end if;
  if p_zone is not null then
    select * into z from public.table_zones where id = p_zone and branch_id = p_branch and active;
    if not found then raise exception 'BAD_ZONE' using errcode = '22023'; end if;
    if src = 'line' and not z.customer_bookable then raise exception 'zone_not_bookable' using errcode = '22023'; end if;
  end if;

  -- one writer per branch-night from here: capacity and the running number
  perform pg_advisory_xact_lock(hashtext(p_branch::text || p_night::text));
  if src = 'line' and s.max_bookings_per_night is not null and private.live_bookings(p_branch, p_night) >= s.max_bookings_per_night then
    raise exception 'full' using errcode = '22023';
  end if;
  if p_table is not null then
    if not exists (select 1 from public.tables where id = p_table and branch_id = p_branch and active) then
      raise exception 'BAD_TABLE' using errcode = '22023';
    end if;
    if not private.table_free(p_table, p_night, null) then raise exception 'table_taken' using errcode = '22023'; end if;
  end if;

  select coalesce(max(substr(code, 9, 3)::int), 0) + 1 into seq from public.bookings where branch_id = p_branch and night = p_night;
  new_code := 'BK-' || to_char(p_night, 'MMDD') || '-' || lpad(seq::text, 3, '0');
  st := case when src = 'staff' or s.auto_confirm then 'confirmed' else 'pending' end;

  insert into public.bookings (branch_id, code, night, slot_time, party_size, zone_id, table_id, customer_id,
    name, phone, note, source, status, created_by, confirmed_by, confirmed_at)
  values (p_branch, new_code, p_night, p_slot, p_party, p_zone, p_table, p_customer_id,
    btrim(p_name), nullif(btrim(p_phone), ''), nullif(btrim(p_note), ''), src, st,
    auth.uid(), case when st = 'confirmed' and src = 'staff' then auth.uid() end,
    case when st = 'confirmed' then now() end)
  returning id, qr_token into new_id, token;

  perform private.notify_booking(new_id, case when st = 'confirmed' then 'booking_confirmed' else 'booking_pending' end,
    '{}'::jsonb, 'booking_created:' || new_id);
  if st = 'pending' then
    perform private.notify_staff_group(p_branch, 'booking_new',
      jsonb_build_object('booking_id', new_id, 'code', new_code, 'name', p_name, 'party', p_party,
        'night', p_night, 'time', to_char(p_slot, 'HH24:MI')), 'booking_new:' || new_id);
  end if;
  return jsonb_build_object('id', new_id, 'code', new_code, 'status', st, 'qr_token', token);
end $$;

create or replace function public.confirm_booking(p_booking uuid, p_table uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(b.branch_id, array['bar', 'owner']::public.user_role[]);
  if b.status <> 'pending' then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if p_table is not null then
    if not exists (select 1 from public.tables where id = p_table and branch_id = b.branch_id and active) then raise exception 'BAD_TABLE' using errcode = '22023'; end if;
    if not private.table_free(p_table, b.night, b.id) then raise exception 'table_taken' using errcode = '22023'; end if;
  end if;
  update public.bookings set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
    table_id = coalesce(p_table, table_id)
  where id = b.id;
  perform private.notify_booking(b.id, 'booking_confirmed', '{}'::jsonb, 'booking_confirmed:' || b.id);
  return jsonb_build_object('id', b.id, 'status', 'confirmed');
end $$;

create or replace function public.reject_booking(p_booking uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(b.branch_id, array['bar', 'owner']::public.user_role[]);
  if b.status not in ('pending', 'confirmed') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  update public.bookings set status = 'rejected', rejected_at = now(), reject_reason = nullif(btrim(p_reason), ''), table_id = null
  where id = b.id;
  perform private.notify_booking(b.id, 'booking_rejected', jsonb_build_object('reason', p_reason), 'booking_rejected:' || b.id);
  return jsonb_build_object('id', b.id, 'status', 'rejected');
end $$;

create or replace function public.assign_table(p_booking uuid, p_table uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(b.branch_id, array['bar', 'owner']::public.user_role[]);
  if b.status not in ('pending', 'confirmed', 'arrived') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if p_table is not null then
    if not exists (select 1 from public.tables where id = p_table and branch_id = b.branch_id and active) then raise exception 'BAD_TABLE' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtext(b.branch_id::text || b.night::text));
    if not private.table_free(p_table, b.night, b.id) then raise exception 'table_taken' using errcode = '22023'; end if;
  end if;
  update public.bookings set table_id = p_table where id = b.id;
  return jsonb_build_object('id', b.id, 'table_id', p_table);
end $$;

-- check-in by QR token or booking code (code is unique per branch, so the branch is part of the lookup)
create or replace function public.check_in_booking(p_branch uuid, p_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; ref text := btrim(coalesce(p_ref, ''));
begin
  perform private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
  select * into b from public.bookings where qr_token = lower(ref) for update;
  if not found then
    select * into b from public.bookings where branch_id = p_branch and code = upper(ref)
    order by night desc limit 1 for update;
  end if;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if b.branch_id <> p_branch then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if b.night <> private.business_night(now()) then raise exception 'WRONG_NIGHT' using errcode = '22023'; end if;
  if b.status = 'arrived' then return jsonb_build_object('id', b.id, 'status', 'arrived', 'already', true); end if;
  if b.status not in ('pending', 'confirmed', 'no_show') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  update public.bookings set status = 'arrived', arrived_at = now(), checked_in_by = auth.uid(),
    confirmed_at = coalesce(confirmed_at, now()), no_show_at = null
  where id = b.id;
  return jsonb_build_object('id', b.id, 'status', 'arrived', 'already', false);
end $$;

-- cancel by staff (authenticated) or by the customer (service role + p_customer_id, inside the window)
create or replace function public.cancel_booking(p_booking uuid, p_reason text default null, p_customer_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; s public.booking_settings%rowtype; by_cust boolean := false;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if private.is_service() then
    if p_customer_id is null or b.customer_id is distinct from p_customer_id then raise exception 'NOT_YOURS' using errcode = '42501'; end if;
    by_cust := true;
  else
    perform private.require_role(b.branch_id, array['staff', 'bar', 'owner']::public.user_role[]);
  end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if by_cust then
    select * into s from public.booking_settings where branch_id = b.branch_id;
    if now() > private.slot_instant(b.night, b.slot_time, s.slot_start) - make_interval(hours => s.customer_cancel_hours) then
      raise exception 'cancel_too_late' using errcode = '22023';
    end if;
  end if;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), ''),
    cancelled_by_customer = by_cust, table_id = null
  where id = b.id;
  perform private.notify_booking(b.id, 'booking_cancelled', '{}'::jsonb, 'booking_cancelled:' || b.id);
  return jsonb_build_object('id', b.id, 'status', 'cancelled');
end $$;

-- cron (every 5 min): pending/confirmed past slot + no_show_minutes → no_show
create or replace function public.mark_no_shows()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (private.is_service() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.bookings b set status = 'no_show', no_show_at = now(), table_id = null
  from public.booking_settings s
  where s.branch_id = b.branch_id and b.status in ('pending', 'confirmed')
    and b.night >= current_date - 2
    and now() > private.slot_instant(b.night, b.slot_time, s.slot_start) + make_interval(mins => s.no_show_minutes);
  get diagnostics n = row_count;
  return n;
end $$;

-- per night between p_from and p_to: closed? why? how many live bookings? which slots are bookable?
create or replace function public.booking_availability(p_branch uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.booking_settings%rowtype; today date := private.business_night(now()); nights jsonb := '[]'::jsonb; d date;
  booked int; closed boolean; why text; is_full boolean; bkk_now time := (now() at time zone 'Asia/Bangkok')::time;
begin
  if not private.is_service() then
    perform private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
  end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  select * into s from public.booking_settings where branch_id = p_branch;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  d := p_from;
  while d <= p_to loop
    booked := private.live_bookings(p_branch, d);
    why := null;
    if (extract(isodow from d)::int - 1) = any (s.closed_weekdays) then why := 'closed_weekday';
    elsif exists (select 1 from public.booking_blackouts where branch_id = p_branch and night = d) then why := 'blackout';
    elsif d < today then why := 'past';
    elsif d > today + s.advance_days then why := 'too_far';
    elsif d = today and bkk_now >= s.cutoff_time and bkk_now >= time '06:00' then why := 'cutoff';
    end if;
    closed := why is not null;
    is_full := s.max_bookings_per_night is not null and booked >= s.max_bookings_per_night;
    nights := nights || jsonb_build_object(
      'night', d, 'closed', closed, 'reason', why,
      'blackout_reason', (select reason from public.booking_blackouts where branch_id = p_branch and night = d),
      'booked', booked, 'capacity', s.max_bookings_per_night, 'full', is_full,
      'slots', (select coalesce(jsonb_agg(to_char(t, 'HH24:MI') order by private.slot_instant(d, t, s.slot_start)), '[]'::jsonb) from private.slots(s) t));
    d := d + 1;
  end loop;
  return jsonb_build_object('line_enabled', s.line_enabled, 'party_min', s.party_min, 'party_max', s.party_max,
    'cancel_hours', s.customer_cancel_hours, 'nights', nights);
end $$;

-- ── RLS + grants ─────────────────────────────────────────────────────────
alter table public.table_zones enable row level security;
alter table public.tables enable row level security;
alter table public.booking_settings enable row level security;
alter table public.booking_blackouts enable row level security;
alter table public.bookings enable row level security;

revoke all on public.table_zones, public.tables, public.booking_settings, public.booking_blackouts, public.bookings
  from public, anon, authenticated;
grant select, insert, update, delete on public.table_zones, public.tables, public.booking_blackouts to authenticated;
grant select, update on public.booking_settings to authenticated;
grant select on public.bookings to authenticated;

create policy table_zones_select on public.table_zones for select to authenticated using (branch_id in (select private.my_branch_ids()));
create policy table_zones_insert on public.table_zones for insert to authenticated with check ((select private.is_owner()));
create policy table_zones_update on public.table_zones for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy table_zones_delete on public.table_zones for delete to authenticated using ((select private.is_owner()));

create policy tables_select on public.tables for select to authenticated using (branch_id in (select private.my_branch_ids()));
create policy tables_insert on public.tables for insert to authenticated with check ((select private.is_owner()));
create policy tables_update on public.tables for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy tables_delete on public.tables for delete to authenticated using ((select private.is_owner()));

create policy booking_settings_select on public.booking_settings for select to authenticated using (branch_id in (select private.my_branch_ids()));
create policy booking_settings_update on public.booking_settings for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));

create policy booking_blackouts_select on public.booking_blackouts for select to authenticated using (branch_id in (select private.my_branch_ids()));
create policy booking_blackouts_insert on public.booking_blackouts for insert to authenticated with check ((select private.is_owner()));
create policy booking_blackouts_update on public.booking_blackouts for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy booking_blackouts_delete on public.booking_blackouts for delete to authenticated using ((select private.is_owner()));

create policy bookings_select on public.bookings for select to authenticated using (branch_id in (select private.my_branch_ids()));

create policy customers_select_booking on public.customers for select to authenticated
  using (exists (select 1 from public.bookings b where b.customer_id = customers.id and b.branch_id in (select private.my_branch_ids())));

revoke all on function public.create_booking(uuid, date, time, integer, text, text, uuid, text, uuid, uuid) from public, anon;
revoke all on function public.confirm_booking(uuid, uuid) from public, anon;
revoke all on function public.reject_booking(uuid, text) from public, anon;
revoke all on function public.assign_table(uuid, uuid) from public, anon;
revoke all on function public.check_in_booking(uuid, text) from public, anon;
revoke all on function public.cancel_booking(uuid, text, uuid) from public, anon;
revoke all on function public.mark_no_shows() from public, anon, authenticated;
revoke all on function public.booking_availability(uuid, date, date) from public, anon;
grant execute on function public.create_booking(uuid, date, time, integer, text, text, uuid, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.confirm_booking(uuid, uuid) to authenticated;
grant execute on function public.reject_booking(uuid, text) to authenticated;
grant execute on function public.assign_table(uuid, uuid) to authenticated;
grant execute on function public.check_in_booking(uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.mark_no_shows() to service_role;
grant execute on function public.booking_availability(uuid, date, date) to authenticated, service_role;

revoke all on function private.slot_instant(date, time, time) from public, anon;
revoke all on function private.slots(public.booking_settings) from public, anon;
revoke all on function private.live_bookings(uuid, date) from public, anon, authenticated;
revoke all on function private.notify_booking(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function private.table_free(uuid, date, uuid) from public, anon, authenticated;
revoke all on function private.guard_table_zone() from public, anon, authenticated;
revoke all on function private.create_booking_settings() from public, anon, authenticated;

-- P1-02 follow-up: trigger-only functions never needed PUBLIC execute
revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.guard_profile_update() from public, anon;
revoke all on function private.guard_deposit_expiry_vip() from public, anon;
grant execute on function private.guard_profile_update() to authenticated, service_role;
grant execute on function private.guard_deposit_expiry_vip() to authenticated, service_role;
