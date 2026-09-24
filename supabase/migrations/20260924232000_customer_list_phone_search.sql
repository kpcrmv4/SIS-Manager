-- R-048 · customer_list: a whole phone typed with the country code (+66 9x xxx xxxx) searches as
-- the number it is (09xxxxxxxx), the same way phones are matched everywhere else. A part of a
-- number still searches on its digits. Everything else as in 20260924230000_customers.

create or replace function public.customer_list(
  p_branch uuid, p_q text default null, p_filter text default 'all', p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_filter text := coalesce(nullif(btrim(coalesce(p_filter, '')), ''), 'all');
  v_like text;
  v_digits text;
  v_tonight date := private.business_night(now());
  v_out jsonb;
begin
  if not private.is_member(p_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_filter not in ('all', 'in_store', 'vip', 'line') then raise exception 'BAD_TYPE' using errcode = '22023'; end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := coalesce(private.phone_key(v_q), regexp_replace(v_q, '[^0-9]', '', 'g'));
    if length(v_digits) < 3 then v_digits := null; end if;
  end if;

  with m as (
    select mm.* from private.branch_people_map(p_branch) mm where mm.person is not null
  ),
  own as (select o.* from private.branch_phone_owners(p_branch) o),
  vip as (select v.customer_id, v.phone_key from public.customer_vips v where v.branch_id = p_branch),
  dep as (
    select m.person, d.created_at as at, d.customer_name as nm, d.customer_phone as ph, d.code,
      private.phone_key(d.customer_phone) as k, d.status, d.remaining_qty
    from m join public.deposits d on d.id = m.id where m.kind = 'd'
  ),
  bk as (
    select m.person, b.created_at as at, b.name as nm, b.phone as ph, b.code,
      private.phone_key(b.phone) as k, b.status, b.night
    from m join public.bookings b on b.id = m.id where m.kind = 'b'
  ),
  recs as (
    select dep.person, dep.at, dep.nm, dep.ph, dep.code, dep.k from dep
    union all
    select bk.person, bk.at, bk.nm, bk.ph, bk.code, bk.k from bk
  ),
  people as (
    select r.person,
      (array_agg(r.nm order by r.at desc) filter (where nullif(btrim(r.nm), '') is not null))[1] as name,
      (array_agg(r.ph order by r.at desc) filter (where nullif(btrim(r.ph), '') is not null))[1] as phone,
      max(r.at) as last_at,
      bool_or(v_q is null or r.nm ilike v_like or r.code ilike v_like
        or (v_digits is not null and r.k like '%' || v_digits || '%')) as hit
    from recs r group by r.person
  ),
  ds as (
    select dep.person,
      count(*) filter (where dep.status <> 'cancelled') as deposits,
      count(*) filter (where dep.status in ('in_store', 'pending_withdrawal')) as deposits_in_store,
      coalesce(sum(dep.remaining_qty) filter (where dep.status in ('in_store', 'pending_withdrawal')), 0) as bottles_in_store
    from dep group by dep.person
  ),
  bs as (
    select bk.person, count(*) as bookings,
      min(bk.night) filter (where bk.night >= v_tonight and bk.status in ('pending', 'confirmed')) as next_night
    from bk group by bk.person
  ),
  flagged as (
    select p.person, p.name, p.phone, p.last_at, p.hit, c.id as customer_id, c.display_name as line_name,
      coalesce(ds.deposits, 0) as deposits, coalesce(ds.deposits_in_store, 0) as deposits_in_store,
      coalesce(ds.bottles_in_store, 0) as bottles_in_store, coalesce(bs.bookings, 0) as bookings, bs.next_night,
      case
        when p.person like 'c-%' then exists (
          select 1 from vip v where v.customer_id = c.id
            or v.phone_key in (select o.phone_key from own o where o.customer_id = c.id))
        when p.person like 'p-%' then exists (select 1 from vip v where v.phone_key = substr(p.person, 3))
        else false
      end as is_vip
    from people p
    -- CASE, not AND: a 'p-' key must never reach the uuid cast
    left join public.customers c on c.id = case when p.person like 'c-%' then substr(p.person, 3)::uuid end
    left join ds on ds.person = p.person
    left join bs on bs.person = p.person
  ),
  hits as (
    select f.* from flagged f
    where (f.hit or (v_like is not null and f.line_name ilike v_like))
      and (v_filter = 'all'
        or (v_filter = 'in_store' and f.deposits_in_store > 0)
        or (v_filter = 'vip' and f.is_vip)
        or (v_filter = 'line' and f.customer_id is not null))
  ),
  page as (
    select h.* from hits h
    order by h.last_at desc nulls last, h.name, h.person
    limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'counts', (select jsonb_build_object(
        'all', count(*),
        'in_store', count(*) filter (where f.deposits_in_store > 0),
        'vip', count(*) filter (where f.is_vip),
        'line', count(*) filter (where f.customer_id is not null)) from flagged f),
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'key', pg.person, 'name', coalesce(pg.name, pg.line_name, ''), 'phone', pg.phone,
        'line', pg.customer_id is not null, 'line_name', pg.line_name,
        'is_vip', pg.is_vip, 'can_vip', pg.person not like 'n-%',
        'bottles_in_store', pg.bottles_in_store, 'deposits_in_store', pg.deposits_in_store,
        'deposits', pg.deposits, 'bookings', pg.bookings, 'next_night', pg.next_night, 'last_at', pg.last_at)
      order by pg.last_at desc nulls last, pg.name, pg.person) from page pg), '[]'::jsonb))
  into v_out;
  return v_out;
end $$;

