-- R-056 · ปิดการจองโต๊ะนี้ (owner request): bar or owner close one table to bookings for one night
-- straight from the floor plan or the รับจอง form, with no customer details, and open it again —
-- the same table_blocks row the owner already sets on /settings/tables (R-036). Customers who
-- pick their own table see a table closed that night as taken (จองแล้ว), not as closed; a table
-- switched off for customers for good still reads blocked. Staff seating stays unlimited (R-036).

create or replace function public.set_table_closed(p_table uuid, p_night date, p_closed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.tables%rowtype;
begin
  select * into t from public.tables where id = p_table and active;
  if not found then raise exception 'BAD_TABLE' using errcode = '22023'; end if;
  perform private.require_role(t.branch_id, array['bar', 'owner']::public.user_role[]);
  if p_night is null or p_night < private.business_night(now()) then raise exception 'past' using errcode = '22023'; end if;
  if coalesce(p_closed, false) then
    -- the same lock create_booking takes: a booking and a block can't both take the table unseen
    perform pg_advisory_xact_lock(hashtext(t.branch_id::text || p_night::text));
    if not private.table_free(p_table, p_night, null) then raise exception 'table_taken' using errcode = '22023'; end if;
    insert into public.table_blocks (branch_id, table_id, night) values (t.branch_id, p_table, p_night)
    on conflict (table_id, night) do nothing;
  else
    delete from public.table_blocks where table_id = p_table and night = p_night;
  end if;
  return jsonb_build_object('table_id', p_table, 'night', p_night, 'closed', coalesce(p_closed, false));
end $$;

revoke all on function public.set_table_closed(uuid, date, boolean) from public, anon;
grant execute on function public.set_table_closed(uuid, date, boolean) to authenticated;

-- The floor plan of one night, as customers see it: blocked = never open to customers (the table's
-- or its zone's switch); taken = a live booking holds it, or the shop closed it that night.
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
          when not (t.customer_bookable and z.customer_bookable) then 'blocked'
          when exists (select 1 from public.table_blocks b where b.table_id = t.id and b.night = p_night)
            or not private.table_free(t.id, p_night, null) then 'taken'
          else 'free' end) order by t.sort, t.label)
      from public.tables t where t.zone_id = z.id and t.active), '[]'::jsonb)) order by z.sort, z.name)
    from public.table_zones z where z.branch_id = p_branch and z.active), '[]'::jsonb));
end $$;
