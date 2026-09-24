-- R-048 · customer_detail also counts what a VIP change would touch, so the confirm dialog names
-- the number before it is pressed: to_vip (not VIP yet: in store, waiting for bar or expired) and
-- vip_deposits (VIP, in store or waiting for bar). Everything else as in 20260924230000_customers.

create or replace function public.customer_detail(
  p_branch uuid, p_key text, p_dep_offset integer default 0, p_bk_offset integer default 0, p_page integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_person text;
  v_cid uuid;
  v_phones text[] := '{}';
  v_dep uuid[];
  v_bk uuid[];
  v_page integer := greatest(1, least(coalesce(p_page, 20), 100));
  v_tonight date := private.business_night(now());
  v_out jsonb;
begin
  if not private.is_member(p_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_person := private.resolve_person(p_branch, p_key);
  if v_person is null then return null; end if;
  select coalesce(array_agg(m.id) filter (where m.kind = 'd'), '{}'), coalesce(array_agg(m.id) filter (where m.kind = 'b'), '{}')
    into v_dep, v_bk
  from private.branch_people_map(p_branch) m where m.person = v_person;
  if cardinality(v_dep) + cardinality(v_bk) = 0 then return null; end if;
  if v_person like 'c-%' then
    v_cid := substr(v_person, 3)::uuid;
    v_phones := private.customer_phones(p_branch, v_cid);
  elsif v_person like 'p-%' then
    v_phones := array[substr(v_person, 3)];
  end if;

  with recs as (
    select d.created_at as at, d.customer_name as nm, d.customer_phone as ph from public.deposits d where d.id = any (v_dep)
    union all
    select b.created_at, b.name, b.phone from public.bookings b where b.id = any (v_bk)
  ),
  names as (
    select r.nm, max(r.at) as at from recs r where nullif(btrim(r.nm), '') is not null group by r.nm
  ),
  phones as (
    select private.phone_key(r.ph) as k, (array_agg(r.ph order by r.at desc))[1] as ph, max(r.at) as at
    from recs r where private.phone_key(r.ph) is not null group by 1
  ),
  deps as (select d.* from public.deposits d where d.id = any (v_dep)),
  bks as (select b.* from public.bookings b where b.id = any (v_bk)),
  vip as (
    select v.created_at, v.created_by from public.customer_vips v
    where v.branch_id = p_branch and ((v_cid is not null and v.customer_id = v_cid) or v.phone_key = any (v_phones))
  ),
  next_bk as (
    select b.night, b.slot_time, b.code, b.status from bks b
    where b.night >= v_tonight and b.status in ('pending', 'confirmed')
    order by b.night, b.slot_time limit 1
  )
  select jsonb_build_object(
    'key', v_person,
    'name', coalesce((select n.nm from names n order by n.at desc limit 1), (select c.display_name from public.customers c where c.id = v_cid), ''),
    'names', coalesce((select jsonb_agg(x.nm order by x.at desc) from (select n.nm, n.at from names n order by n.at desc limit 6) x), '[]'::jsonb),
    'phones', coalesce((select jsonb_agg(x.ph order by x.at desc) from (select p.ph, p.at from phones p order by p.at desc limit 4) x), '[]'::jsonb),
    'line', (select jsonb_build_object('name', c.display_name, 'picture', c.picture_url, 'locale', c.locale,
               'reminders', c.expiry_notices_enabled) from public.customers c where c.id = v_cid),
    'can_vip', v_person not like 'n-%',
    'vip', (select jsonb_build_object('since', min(v.created_at),
               'by', (select coalesce(nullif(pr.display_name, ''), pr.username) from vip v2
                      join public.profiles pr on pr.id = v2.created_by order by v2.created_at limit 1))
            from vip v having count(*) > 0),
    'stats', jsonb_build_object(
      'bottles_in_store', (select coalesce(sum(d.remaining_qty), 0) from deps d where d.status in ('in_store', 'pending_withdrawal')),
      'deposits_in_store', (select count(*) from deps d where d.status in ('in_store', 'pending_withdrawal')),
      'deposits', (select count(*) from deps d where d.status <> 'cancelled'),
      'expired', (select count(*) from deps d where d.status = 'expired'),
      'bottles_withdrawn', (select count(*) from public.withdrawals w where w.deposit_id = any (v_dep) and w.status = 'completed'),
      'bookings', cardinality(v_bk),
      'arrived', (select count(*) from bks b where b.status = 'arrived'),
      'no_show', (select count(*) from bks b where b.status = 'no_show'),
      'cancelled', (select count(*) from bks b where b.status in ('cancelled', 'rejected')),
      'next_booking', (select jsonb_build_object('night', n.night, 'time', to_char(n.slot_time, 'HH24:MI'), 'code', n.code, 'status', n.status) from next_bk n),
      'first_at', (select min(r.at) from recs r),
      'last_at', (select max(r.at) from recs r),
      'to_vip', (select count(*) from deps d where not d.is_vip and d.status in ('pending_confirm', 'in_store', 'pending_withdrawal', 'expired')),
      'vip_deposits', (select count(*) from deps d where d.is_vip and d.status in ('pending_confirm', 'in_store', 'pending_withdrawal'))),
    'deposits', jsonb_build_object(
      'total', cardinality(v_dep),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'code', x.code, 'item', x.item_name, 'quantity', x.quantity, 'remaining_qty', x.remaining_qty,
          'remaining_percent', x.remaining_percent, 'status', x.status, 'is_vip', x.is_vip, 'expires_at', x.expires_at,
          'created_at', x.created_at, 'table', x.table_label, 'name', x.customer_name)
        order by x.created_at desc, x.id)
        from (select d.* from deps d order by d.created_at desc, d.id limit v_page offset greatest(0, coalesce(p_dep_offset, 0))) x), '[]'::jsonb)),
    'bookings', jsonb_build_object(
      'total', cardinality(v_bk),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'code', x.code, 'night', x.night, 'time', to_char(x.slot_time, 'HH24:MI'), 'party', x.party_size,
          'status', x.status, 'source', x.source, 'zone', z.name, 'table', t.label, 'name', x.name)
        order by x.night desc, x.slot_time desc, x.id)
        from (select b.* from bks b order by b.night desc, b.slot_time desc, b.id limit v_page offset greatest(0, coalesce(p_bk_offset, 0))) x
        left join public.table_zones z on z.id = x.zone_id
        left join public.tables t on t.id = x.table_id), '[]'::jsonb))
  ) into v_out;
  return v_out;
end $$;
