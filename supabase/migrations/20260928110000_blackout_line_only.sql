-- R-067 (owner, 2026-09-28): a blackout night is either the shop closed (nobody books) or
-- "no LINE bookings" — customers can't book themselves, staff still enter bookings taken another way.
-- New nights default to LINE-only; nights already set keep closing everyone, as they did.
alter table public.booking_blackouts add column if not exists line_only boolean not null default true;
update public.booking_blackouts set line_only = false;

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
  -- R-067: a LINE-only blackout stops the customer, not the staff taking the booking by phone / in person
  if exists (select 1 from public.booking_blackouts where branch_id = p_branch and night = p_night and (src = 'line' or not line_only)) then
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
      'blackout_line_only', (select line_only from public.booking_blackouts where branch_id = p_branch and night = d),
      'booked', booked, 'capacity', s.max_bookings_per_night, 'full', is_full,
      'slots', (select coalesce(jsonb_agg(to_char(t, 'HH24:MI') order by private.slot_instant(d, t, s.slot_start)), '[]'::jsonb) from private.slots(s) t));
    d := d + 1;
  end loop;
  return jsonb_build_object('line_enabled', s.line_enabled, 'party_min', s.party_min, 'party_max', s.party_max,
    'cancel_hours', s.customer_cancel_hours, 'nights', nights);
end $$;
