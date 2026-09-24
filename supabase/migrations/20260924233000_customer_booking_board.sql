-- R-049 · The customers page finds a night's bookings (owner request): typing BK-0925 shows the
-- bookings of that night as tiles, typing on to BK-0925-001 leaves that one, and the จองวันนี้ /
-- จองพรุ่งนี้ shortcuts do the same for tonight and tomorrow. Each tile names the table and who
-- booked, and says whether that customer is VIP here and how many bottles they keep here — the
-- customer as customer_list sees them (R-048), so a tile opens the same customer page.
--
-- p_seq: the digits typed after the date. '1' finds 001 as well as 1xx — nobody types the zeros.

create or replace function public.customer_booking_board(p_branch uuid, p_night date, p_seq text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_seq text := nullif(regexp_replace(coalesce(p_seq, ''), '[^0-9]', '', 'g'), '');
  v_out jsonb;
begin
  if not private.is_member(p_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_night is null then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  if length(v_seq) > 3 then v_seq := left(v_seq, 3); end if;

  with bk as (
    select b.* from public.bookings b
    where b.branch_id = p_branch and b.night = p_night
      and (v_seq is null
        or split_part(b.code, '-', 3) like v_seq || '%'
        or split_part(b.code, '-', 3) = lpad(v_seq, 3, '0'))
  ),
  m as (select mm.* from private.branch_people_map(p_branch) mm where mm.person is not null),
  bp as (select bk.*, m.person from bk left join m on m.kind = 'b' and m.id = bk.id),
  own as (select o.* from private.branch_phone_owners(p_branch) o),
  vip as (select v.customer_id, v.phone_key from public.customer_vips v where v.branch_id = p_branch),
  store as (
    select m.person, coalesce(sum(d.remaining_qty), 0) as bottles
    from m join public.deposits d on d.id = m.id
    where m.kind = 'd' and d.status in ('in_store', 'pending_withdrawal') and m.person in (select bp.person from bp)
    group by m.person
  ),
  tiles as (
    select bp.id, bp.code, bp.night, bp.slot_time, bp.party_size, bp.status, bp.source, bp.name, bp.person,
      t.label as table_label, z.name as zone_name, coalesce(s.bottles, 0) as bottles,
      -- CASE, so a 'p-' key never reaches the uuid cast
      case
        when bp.person like 'c-%' then exists (
          select 1 from vip v where v.customer_id = substr(bp.person, 3)::uuid
            or v.phone_key in (select o.phone_key from own o where o.customer_id = substr(bp.person, 3)::uuid))
        when bp.person like 'p-%' then exists (select 1 from vip v where v.phone_key = substr(bp.person, 3))
        else false
      end as is_vip
    from bp
    left join public.tables t on t.id = bp.table_id
    left join public.table_zones z on z.id = bp.zone_id
    left join store s on s.person = bp.person
  )
  select jsonb_build_object(
    'night', p_night,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'code', x.code, 'time', to_char(x.slot_time, 'HH24:MI'), 'party', x.party_size, 'status', x.status,
        'source', x.source, 'name', x.name, 'key', x.person, 'table', x.table_label, 'zone', x.zone_name,
        'bottles', x.bottles, 'is_vip', x.is_vip)
      order by x.slot_time, x.table_label nulls last, x.code) from tiles x), '[]'::jsonb))
  into v_out;
  return v_out;
end $$;

revoke all on function public.customer_booking_board(uuid, date, text) from public, anon;
grant execute on function public.customer_booking_board(uuid, date, text) to authenticated;
