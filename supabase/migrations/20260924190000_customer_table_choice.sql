-- R-036 · A branch may let its customers pick their own table in LINE (owner request).
-- booking_settings.table_choice: 'shop' (the shop seats the booking — the behaviour so far) or
-- 'customer' (the LIFF shows the floor plan and a customer booking must name a free table).
-- Which tables customers may take: tables.customer_bookable (off = never), the zone's
-- customer_bookable, and table_blocks (off on the named nights only). Staff bookings and
-- staff table assignment are not limited by these — they are the shop's own choice.

alter table public.booking_settings
  add column if not exists table_choice text not null default 'shop' check (table_choice in ('shop', 'customer'));
alter table public.tables
  add column if not exists customer_bookable boolean not null default true;

create table if not exists public.table_blocks (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  table_id uuid not null references public.tables (id) on delete cascade,
  night date not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (table_id, night)
);
create index if not exists table_blocks_branch_night_idx on public.table_blocks (branch_id, night);

-- a block's table must be in the block's branch; the author is whoever is signed in
create or replace function private.guard_table_block()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.tables t where t.id = new.table_id and t.branch_id = new.branch_id) then
    raise exception 'TABLE_OTHER_BRANCH' using errcode = '23514';
  end if;
  new.created_by := auth.uid();
  return new;
end $$;
drop trigger if exists table_blocks_guard on public.table_blocks;
create trigger table_blocks_guard before insert or update on public.table_blocks
  for each row execute function private.guard_table_block();

alter table public.table_blocks enable row level security;
revoke all on public.table_blocks from public, anon, authenticated;
grant select, insert, delete on public.table_blocks to authenticated;
drop policy if exists table_blocks_select on public.table_blocks;
drop policy if exists table_blocks_insert on public.table_blocks;
drop policy if exists table_blocks_delete on public.table_blocks;
create policy table_blocks_select on public.table_blocks for select to authenticated using (branch_id in (select private.my_branch_ids()));
create policy table_blocks_insert on public.table_blocks for insert to authenticated with check ((select private.is_owner()));
create policy table_blocks_delete on public.table_blocks for delete to authenticated using ((select private.is_owner()));

-- may a customer take this table on this night? (its own switch, its zone's, no block that night)
create or replace function private.table_open_to_customers(p_table uuid, p_night date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tables t
    join public.table_zones z on z.id = t.zone_id
    where t.id = p_table and t.active and t.customer_bookable and z.active and z.customer_bookable
      and not exists (select 1 from public.table_blocks b where b.table_id = t.id and b.night = p_night))
$$;

-- The floor plan of one night: every active zone and table with its state — free, taken (a live
-- booking holds it) or blocked (closed to customers that night). Never who holds a table.
create or replace function public.table_availability(p_branch uuid, p_night date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.booking_settings%rowtype;
begin
  if not private.is_service() then
    perform private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
  end if;
  if p_night is null then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  select * into s from public.booking_settings where branch_id = p_branch;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('night', p_night, 'table_choice', s.table_choice, 'zones', coalesce((
    select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'shape', t.shape, 'seats_min', t.seats_min, 'seats_max', t.seats_max,
        'state', case
          when not private.table_open_to_customers(t.id, p_night) then 'blocked'
          when not private.table_free(t.id, p_night, null) then 'taken'
          else 'free' end) order by t.sort, t.label)
      from public.tables t where t.zone_id = z.id and t.active), '[]'::jsonb)) order by z.sort, z.name)
    from public.table_zones z where z.branch_id = p_branch and z.active), '[]'::jsonb));
end $$;

-- create_booking: a customer may name a table only when the branch lets customers choose — and
-- then must; the table must be open to customers that night, fit the party and still be free.
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
  tb public.tables%rowtype;
  v_zone uuid := p_zone;
begin
  if private.is_service() then
    src := 'line';
    if p_customer_id is null then raise exception 'CUSTOMER_REQUIRED' using errcode = '22023'; end if;
  else
    perform private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
    src := 'staff';
  end if;
  select * into s from public.booking_settings where branch_id = p_branch;
  if not found or not exists (select 1 from public.branches where id = p_branch and active) then
    raise exception 'BRANCH_INACTIVE' using errcode = '22023';
  end if;
  if src = 'line' and p_table is not null and s.table_choice <> 'customer' then
    raise exception 'FORBIDDEN' using errcode = '42501';
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
  if src = 'line' and s.table_choice = 'customer' and p_table is null then
    raise exception 'table_required' using errcode = '22023';
  end if;
  if p_table is not null then
    select * into tb from public.tables where id = p_table and branch_id = p_branch and active;
    if not found then raise exception 'BAD_TABLE' using errcode = '22023'; end if;
    if src = 'line' then
      if not private.table_open_to_customers(p_table, p_night) then raise exception 'table_not_bookable' using errcode = '22023'; end if;
      if p_party < tb.seats_min or p_party > tb.seats_max then raise exception 'table_seats' using errcode = '22023'; end if;
      -- the table decides the zone
      v_zone := tb.zone_id;
    end if;
  end if;
  if v_zone is not null and v_zone is distinct from tb.zone_id then
    select * into z from public.table_zones where id = v_zone and branch_id = p_branch and active;
    if not found then raise exception 'BAD_ZONE' using errcode = '22023'; end if;
    if src = 'line' and not z.customer_bookable then raise exception 'zone_not_bookable' using errcode = '22023'; end if;
  end if;

  -- one writer per branch-night from here: capacity, the table and the running number
  perform pg_advisory_xact_lock(hashtext(p_branch::text || p_night::text));
  if src = 'line' and s.max_bookings_per_night is not null and private.live_bookings(p_branch, p_night) >= s.max_bookings_per_night then
    raise exception 'full' using errcode = '22023';
  end if;
  if p_table is not null and not private.table_free(p_table, p_night, null) then
    raise exception 'table_taken' using errcode = '22023';
  end if;

  select coalesce(max(substr(code, 9, 3)::int), 0) + 1 into seq from public.bookings where branch_id = p_branch and night = p_night;
  new_code := 'BK-' || to_char(p_night, 'MMDD') || '-' || lpad(seq::text, 3, '0');
  st := case when src = 'staff' or s.auto_confirm then 'confirmed' else 'pending' end;

  insert into public.bookings (branch_id, code, night, slot_time, party_size, zone_id, table_id, customer_id,
    name, phone, note, source, status, created_by, confirmed_by, confirmed_at)
  values (p_branch, new_code, p_night, p_slot, p_party, v_zone, p_table, p_customer_id,
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

revoke all on function private.guard_table_block() from public, anon, authenticated;
revoke all on function private.table_open_to_customers(uuid, date) from public, anon, authenticated;
revoke all on function public.table_availability(uuid, date) from public, anon;
grant execute on function public.table_availability(uuid, date) to authenticated, service_role;
revoke all on function public.create_booking(uuid, date, time, integer, text, text, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.create_booking(uuid, date, time, integer, text, text, uuid, text, uuid, uuid) to authenticated, service_role;
