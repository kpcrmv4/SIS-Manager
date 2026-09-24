-- Reports page redesign (R-034): the detail behind the per-branch summary of owner_report —
-- a day-by-day series, the period's top liquor and customers, staff activity and the disposals.
-- Owner only; Bangkok calendar days, the same range rules and definitions as owner_report, so the
-- daily rows add up to its totals. Additive: nothing that exists changes.

create or replace function public.owner_report_detail(p_from date, p_to date, p_branch uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t0 timestamptz; t1 timestamptz;
  days jsonb; items jsonb; people jsonb; staff jsonb; gone jsonb;
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  t0 := private.bkk_start(p_from); t1 := private.bkk_start(p_to + 1);

  -- one row per calendar day: deposits by received day, withdrawals by processed day,
  -- disposals by disposal day, bookings by night
  with d as (
    select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ), dep as (
    select (x.received_at at time zone 'Asia/Bangkok')::date as day, count(*) as n, sum(x.quantity) as q
    from public.deposits x
    where x.received_at >= t0 and x.received_at < t1 and (p_branch is null or x.branch_id = p_branch)
    group by 1
  ), wd as (
    select (x.processed_at at time zone 'Asia/Bangkok')::date as day, count(*) as n, sum(x.qty) as q
    from public.withdrawals x
    where x.status = 'completed' and x.processed_at >= t0 and x.processed_at < t1 and (p_branch is null or x.branch_id = p_branch)
    group by 1
  ), dis as (
    select (x.disposed_at at time zone 'Asia/Bangkok')::date as day, count(*) as n
    from public.deposits x
    where x.status = 'disposed' and x.disposed_at >= t0 and x.disposed_at < t1 and (p_branch is null or x.branch_id = p_branch)
    group by 1
  ), bk as (
    select x.night as day,
           count(*) filter (where x.status not in ('cancelled', 'rejected')) as n,
           count(*) filter (where x.status = 'arrived') as a,
           count(*) filter (where x.status = 'no_show') as ns,
           count(*) filter (where x.status = 'cancelled') as c
    from public.bookings x
    where x.night between p_from and p_to and (p_branch is null or x.branch_id = p_branch)
    group by 1
  )
  select jsonb_agg(jsonb_build_object(
    'day', d.day,
    'deposits', coalesce(dep.n, 0), 'bottles_in', coalesce(dep.q, 0),
    'withdrawals', coalesce(wd.n, 0), 'bottles_out', coalesce(wd.q, 0),
    'disposed', coalesce(dis.n, 0),
    'bookings', coalesce(bk.n, 0), 'arrived', coalesce(bk.a, 0), 'no_shows', coalesce(bk.ns, 0), 'cancelled', coalesce(bk.c, 0)
  ) order by d.day) into days
  from d
  left join dep on dep.day = d.day
  left join wd on wd.day = d.day
  left join dis on dis.day = d.day
  left join bk on bk.day = d.day;

  -- top 5 liquor and customers by bottles deposited (a rejected deposit is not a deposit)
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'deposits', x.n, 'bottles', x.q) order by x.q desc, x.n desc, x.name), '[]'::jsonb) into items
  from (
    select d.item_name as name, count(*) as n, sum(d.quantity) as q
    from public.deposits d
    where d.received_at >= t0 and d.received_at < t1 and d.status <> 'cancelled' and (p_branch is null or d.branch_id = p_branch)
    group by d.item_name
    order by sum(d.quantity) desc, count(*) desc, d.item_name
    limit 5
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'deposits', x.n, 'bottles', x.q, 'linked', x.linked) order by x.q desc, x.n desc, x.name), '[]'::jsonb) into people
  from (
    select max(d.customer_name) as name, count(*) as n, sum(d.quantity) as q, bool_or(d.customer_id is not null) as linked
    from public.deposits d
    where d.received_at >= t0 and d.received_at < t1 and d.status <> 'cancelled' and (p_branch is null or d.branch_id = p_branch)
    group by coalesce(d.customer_id::text, nullif(d.customer_phone, ''), lower(d.customer_name))
    order by sum(d.quantity) desc, count(*) desc, max(d.customer_name)
    limit 5
  ) x;

  -- who did the work: deposits received, bottles confirmed, withdrawals handed over, check-ins
  select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'role', s.role, 'received', s.received, 'confirmed', s.confirmed,
                                               'withdrawals', s.withdrawals, 'check_ins', s.check_ins, 'total', s.total)
                            order by s.total desc, s.name), '[]'::jsonb) into staff
  from (
    select p.display_name as name, p.role,
           count(*) filter (where w.k = 'received') as received,
           count(*) filter (where w.k = 'confirmed') as confirmed,
           count(*) filter (where w.k = 'withdrawal') as withdrawals,
           count(*) filter (where w.k = 'check_in') as check_ins,
           count(*) as total
    from (
      select x.received_by as uid, 'received' as k from public.deposits x
        where x.received_by is not null and x.received_at >= t0 and x.received_at < t1 and (p_branch is null or x.branch_id = p_branch)
      union all
      select x.confirmed_by, 'confirmed' from public.deposits x
        where x.confirmed_by is not null and x.confirmed_at >= t0 and x.confirmed_at < t1 and (p_branch is null or x.branch_id = p_branch)
      union all
      select x.processed_by, 'withdrawal' from public.withdrawals x
        where x.status = 'completed' and x.processed_by is not null and x.processed_at >= t0 and x.processed_at < t1 and (p_branch is null or x.branch_id = p_branch)
      union all
      select x.checked_in_by, 'check_in' from public.bookings x
        where x.checked_in_by is not null and x.arrived_at >= t0 and x.arrived_at < t1 and (p_branch is null or x.branch_id = p_branch)
    ) w
    join public.profiles p on p.id = w.uid
    group by p.id, p.display_name, p.role
    order by count(*) desc, p.display_name
    limit 8
  ) s;

  -- the disposals of the period, newest first
  select coalesce(jsonb_agg(y.r order by y.o desc), '[]'::jsonb) into gone from (
    select d.disposed_at as o, jsonb_build_object(
      'id', d.id, 'item', d.item_name, 'customer', d.customer_name, 'branch', b.name, 'branch_id', b.id,
      'expires_at', d.expires_at, 'disposed_at', d.disposed_at, 'by', p.display_name,
      'notified', exists (select 1 from public.line_outbox o where o.kind = 'disposed' and o.status = 'sent' and o.payload ->> 'deposit_id' = d.id::text)
    ) as r
    from public.deposits d
    join public.branches b on b.id = d.branch_id
    left join public.profiles p on p.id = d.disposed_by
    where d.status = 'disposed' and d.disposed_at >= t0 and d.disposed_at < t1 and (p_branch is null or d.branch_id = p_branch)
    order by d.disposed_at desc
    limit 20
  ) y;

  return jsonb_build_object('from', p_from, 'to', p_to, 'days', days, 'top_items', items, 'top_customers', people, 'staff', staff, 'disposals', gone);
end $$;

revoke all on function public.owner_report_detail(date, date, uuid) from public, anon;
grant execute on function public.owner_report_detail(date, date, uuid) to authenticated;
