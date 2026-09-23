-- Owner overview redesign (R-030). Two owner-only reads next to owner_overview:
--   owner_dashboard() — the "now" snapshot: per-branch work queues, health and setup flags,
--                       tonight by hour, the activity feed, the soonest expiries
--   owner_trends(...) — the previous comparable period, 8 weekly points, busy weekdays,
--                       the period's top customers and liquor
-- Aggregates only (CLAUDE §6); Bangkok dates and business nights (§7). Additive: the deployed
-- app keeps calling owner_overview unchanged.

create index if not exists deposit_events_created_idx on public.deposit_events (created_at desc);
create index if not exists bookings_updated_idx on public.bookings (updated_at desc);
create index if not exists line_outbox_problem_idx on public.line_outbox (branch_id, created_at) where status in ('failed', 'skipped');
create index if not exists deposits_confirmed_at_idx on public.deposits (confirmed_at) where confirmed_at is not null;

-- 06:00 Bangkok of a business night: the night is [night_start(n), night_start(n + 1))
create or replace function private.night_start(p_night date)
returns timestamptz language sql immutable set search_path = '' as $$
  select (p_night::timestamp at time zone 'Asia/Bangkok') + interval '6 hours'
$$;

create or replace function public.owner_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  tonight date := private.business_night(now());
  today date := (now() at time zone 'Asia/Bangkok')::date;
  n0 timestamptz := private.night_start(private.business_night(now()));
  rows jsonb; night_j jsonb; feed jsonb; soon jsonb;
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  -- one row per active branch: queues, health, setup flags, the last 7 nights in / out
  select coalesce(jsonb_agg(r order by s, nm), '[]'::jsonb) into rows from (
    select b.sort as s, b.name as nm, jsonb_build_object(
      'id', b.id, 'code', b.code, 'name', b.name,
      'to_confirm', (select count(*) from public.deposits d where d.branch_id = b.id and d.status = 'pending_confirm'),
      'requests', (select count(*) from public.deposits d where d.branch_id = b.id and d.status = 'requested'),
      'withdrawals', (select count(*) from public.withdrawals w where w.branch_id = b.id and w.status = 'pending'),
      'bookings_pending', (select count(*) from public.bookings k where k.branch_id = b.id and k.status = 'pending' and k.night >= tonight),
      'bookings_pending_night', (select min(k.night) from public.bookings k where k.branch_id = b.id and k.status = 'pending' and k.night >= tonight),
      'to_dispose', (select count(*) from public.deposits d where d.branch_id = b.id and d.status = 'expired'),
      'expiring', (select count(*) from public.deposits d where d.branch_id = b.id and d.status in ('in_store', 'pending_withdrawal') and not d.is_vip
                   and d.expires_at is not null and d.expires_at < private.bkk_start(today + b.expiry_notice_days + 1)),
      'in_store_bottles', coalesce((select sum(d.remaining_qty) from public.deposits d where d.branch_id = b.id and d.status in ('in_store', 'pending_withdrawal')), 0),
      'bookings_tonight', (select count(*) from public.bookings k where k.branch_id = b.id and k.night = tonight and k.status in ('pending', 'confirmed', 'arrived')),
      'arrived_tonight', (select count(*) from public.bookings k where k.branch_id = b.id and k.night = tonight and k.status = 'arrived'),
      -- same 2-minute window as src/lib/print/actions.ts (ONLINE_WINDOW_MS)
      'printer', case when ps.id is null then 'not_set_up'
                      when ps.is_online and ps.last_heartbeat > now() - interval '2 minutes' then 'online'
                      else 'offline' end,
      'line_oa', coalesce(s.channel_access_token is not null and s.channel_secret is not null, false),
      'liff', b.liff_id is not null and b.line_channel_id is not null,
      'staff_group', b.staff_group_id is not null,
      -- still failing, or refused by LINE (HTTP 4xx) — a missing token is a setup item, not a failure
      'line_failed', (select count(*) from public.line_outbox o where o.branch_id = b.id and o.created_at > now() - interval '7 days'
                      and (o.status = 'failed' or (o.status = 'skipped' and o.error like 'HTTP %'))),
      'has_tables', exists (select 1 from public.tables t where t.branch_id = b.id and t.active),
      'has_items', exists (select 1 from public.liquor_items i where (i.branch_id = b.id or i.branch_id is null) and i.active),
      'has_staff', exists (select 1 from public.user_branches ub
                           join public.profiles p on p.id = ub.user_id and p.active and p.role in ('staff', 'bar')
                           where ub.branch_id = b.id),
      'nights', (select jsonb_agg(jsonb_build_object(
                   'night', g.n,
                   'in', coalesce((select sum(d.quantity) from public.deposits d where d.branch_id = b.id
                                   and d.received_at >= private.night_start(g.n) and d.received_at < private.night_start(g.n + 1)), 0),
                   'out', coalesce((select sum(w.qty) from public.withdrawals w where w.branch_id = b.id and w.status = 'completed'
                                    and w.processed_at >= private.night_start(g.n) and w.processed_at < private.night_start(g.n + 1)), 0)
                 ) order by g.n)
                 from (select tonight - i as n from generate_series(0, 6) i) g)
    ) as r
    from public.branches b
    left join public.print_stations ps on ps.branch_id = b.id
    left join public.branch_line_secrets s on s.branch_id = b.id
    where b.active
  ) x;

  -- tonight across active branches: bookings by slot hour (business-night order), bottles in / out since 06:00
  select jsonb_build_object(
    'night', tonight,
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hr, 'bookings', h.c, 'people', h.p, 'arrived', h.a, 'pending', h.pe, 'no_show', h.ns)
                       order by (h.hr + 18) % 24)
      from (
        select extract(hour from k.slot_time)::int as hr, count(*) as c, sum(k.party_size) as p,
               count(*) filter (where k.status = 'arrived') as a,
               count(*) filter (where k.status = 'pending') as pe,
               count(*) filter (where k.status = 'no_show') as ns
        from public.bookings k join public.branches b on b.id = k.branch_id and b.active
        where k.night = tonight and k.status in ('pending', 'confirmed', 'arrived', 'no_show')
        group by 1
      ) h), '[]'::jsonb),
    'open_from', (select left(bs.slot_start::text, 5) from public.booking_settings bs join public.branches b on b.id = bs.branch_id and b.active
                  order by (extract(hour from bs.slot_start)::int + 18) % 24, bs.slot_start limit 1),
    'open_to', (select left(bs.slot_end::text, 5) from public.booking_settings bs join public.branches b on b.id = bs.branch_id and b.active
                order by (extract(hour from bs.slot_end)::int + 18) % 24 desc, bs.slot_end desc limit 1),
    'bottles_in', coalesce((select sum(d.quantity) from public.deposits d join public.branches b on b.id = d.branch_id and b.active
                            where d.received_at >= n0 and d.received_at < n0 + interval '1 day'), 0),
    'bottles_out', coalesce((select sum(w.qty) from public.withdrawals w join public.branches b on b.id = w.branch_id and b.active
                             where w.status = 'completed' and w.processed_at >= n0 and w.processed_at < n0 + interval '1 day'), 0)
  ) into night_j;

  -- the last 7 days of deposit events and booking changes, newest 12
  select coalesce(jsonb_agg(u.e order by u.ts desc), '[]'::jsonb) into feed from (
    select v.e, v.ts from (
      (select ev.created_at as ts, jsonb_build_object(
          'kind', 'deposit', 'key', 'e' || ev.id, 'at', ev.created_at, 'action', ev.action, 'payload', ev.payload,
          'actor_kind', ev.actor_kind, 'actor', p.display_name, 'actor_role', p.role,
          'deposit_id', d.id, 'code', d.code, 'item', d.item_name, 'customer', d.customer_name,
          'branch_id', b.id, 'branch', b.name) as e
       from public.deposit_events ev
       join public.deposits d on d.id = ev.deposit_id
       join public.branches b on b.id = ev.branch_id and b.active
       left join public.profiles p on p.id = ev.actor_id
       where ev.created_at > now() - interval '7 days'
       order by ev.created_at desc
       limit 12)
      union all
      (select k.ts, jsonb_build_object(
          'kind', 'booking', 'key', 'b' || k.id || ':' || k.status::text, 'at', k.ts, 'action', k.action,
          'payload', jsonb_build_object('party', k.party_size, 'slot', left(k.slot_time::text, 5), 'night', k.night, 'source', k.source),
          'actor_kind', k.actor_kind, 'actor', p.display_name, 'actor_role', p.role,
          'booking_id', k.id, 'code', k.code, 'customer', k.name, 'night', k.night,
          'branch_id', b.id, 'branch', b.name) as e
       from (
         select k.*,
           case k.status when 'arrived' then k.arrived_at when 'no_show' then k.no_show_at when 'cancelled' then k.cancelled_at
                         when 'rejected' then k.rejected_at when 'confirmed' then coalesce(k.confirmed_at, k.created_at)
                         else k.created_at end as ts,
           case k.status when 'pending' then 'booking_requested'
                         when 'confirmed' then case when k.source = 'staff' then 'booking_created' else 'booking_confirmed' end
                         else 'booking_' || k.status::text end as action,
           case k.status when 'arrived' then k.checked_in_by
                         when 'confirmed' then coalesce(k.confirmed_by, k.created_by)
                         when 'pending' then k.created_by end as actor_id,
           case when k.status = 'no_show' then 'system'
                when k.status = 'confirmed' and k.source = 'line' and k.confirmed_by is null then 'system'
                when (k.status = 'pending' and k.source = 'line') or (k.status = 'cancelled' and k.cancelled_by_customer) then 'customer'
                else 'staff' end as actor_kind
         from public.bookings k
         where k.updated_at > now() - interval '7 days'
       ) k
       join public.branches b on b.id = k.branch_id and b.active
       left join public.profiles p on p.id = k.actor_id
       where k.ts is not null and k.ts > now() - interval '7 days'
       order by k.ts desc
       limit 12)
    ) v
    order by v.ts desc
    limit 12
  ) u;

  -- the soonest expiries inside each branch's notice window (VIP never expires)
  select coalesce(jsonb_agg(y.r order by y.o, y.c), '[]'::jsonb) into soon from (
    select d.expires_at as o, d.code as c, jsonb_build_object(
      'id', d.id, 'code', d.code, 'item', d.item_name, 'customer', d.customer_name,
      'branch_id', b.id, 'branch', b.name, 'expires_at', d.expires_at, 'remaining', d.remaining_qty,
      'notified', d.expiry_notice_sent_at is not null, 'linked', d.customer_id is not null) as r
    from public.deposits d join public.branches b on b.id = d.branch_id and b.active
    where d.status in ('in_store', 'pending_withdrawal') and not d.is_vip and d.expires_at is not null
      and d.expires_at < private.bkk_start(today + b.expiry_notice_days + 1)
    order by d.expires_at, d.code
    limit 5
  ) y;

  return jsonb_build_object('night', tonight, 'generated_at', now(), 'branches', rows, 'tonight', night_j, 'activity', feed, 'expiring', soon);
end $$;

create or replace function public.owner_trends(p_from date, p_to date, p_prev_from date, p_prev_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t0 timestamptz; t1 timestamptz; q0 timestamptz; q1 timestamptz;
  today date := (now() at time zone 'Asia/Bangkok')::date;
  tonight date := private.business_night(now());
  week0 date;
  prev jsonb; weeks jsonb; days jsonb; people jsonb; liquor jsonb;
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366
     or p_prev_from is null or p_prev_to is null or p_prev_to < p_prev_from or p_prev_to - p_prev_from > 366 then
    raise exception 'BAD_RANGE' using errcode = '22023';
  end if;
  t0 := private.bkk_start(p_from); t1 := private.bkk_start(p_to + 1);
  q0 := private.bkk_start(p_prev_from); q1 := private.bkk_start(p_prev_to + 1);
  -- Monday seven weeks before this week's Monday: 8 weekly points, the last one is this (partial) week
  week0 := today - (extract(isodow from today)::int - 1) - 49;

  -- the previous period, same definitions as owner_overview's kpi
  prev := jsonb_build_object(
    'from', p_prev_from, 'to', p_prev_to,
    'new_deposits', (select count(*) from public.deposits where received_at >= q0 and received_at < q1),
    'bottles_withdrawn', coalesce((select sum(qty) from public.withdrawals where status = 'completed' and processed_at >= q0 and processed_at < q1), 0),
    'disposed', (select count(*) from public.deposits where status = 'disposed' and disposed_at >= q0 and disposed_at < q1),
    'bookings', (select count(*) from public.bookings where night between p_prev_from and p_prev_to and status not in ('cancelled', 'rejected')),
    'arrived', (select count(*) from public.bookings where night between p_prev_from and p_prev_to and status = 'arrived'),
    'no_shows', (select count(*) from public.bookings where night between p_prev_from and p_prev_to and status = 'no_show')
  );

  -- weekly flows + the bottles in store at each week's end (now for the current week):
  -- a bottle is in store at T when its deposit was confirmed by T, the bottle was not
  -- consumed by T, and the deposit had not expired by T
  with w as (
    select week0 + 7 * i as ws, private.bkk_start(week0 + 7 * i) as a, private.bkk_start(week0 + 7 * i + 7) as z
    from generate_series(0, 7) i
  ), ex as (
    select e.deposit_id, min(e.created_at) as exp_at from public.deposit_events e where e.action = 'expired' group by e.deposit_id
  )
  select jsonb_agg(jsonb_build_object(
    'start', w.ws,
    'new_deposits', (select count(*) from public.deposits d where d.received_at >= w.a and d.received_at < w.z),
    'bottles_withdrawn', coalesce((select sum(x.qty) from public.withdrawals x where x.status = 'completed' and x.processed_at >= w.a and x.processed_at < w.z), 0),
    'disposed', (select count(*) from public.deposits d where d.status = 'disposed' and d.disposed_at >= w.a and d.disposed_at < w.z),
    'bookings', (select count(*) from public.bookings k where k.night >= w.ws and k.night < w.ws + 7 and k.status not in ('cancelled', 'rejected')),
    'arrived', (select count(*) from public.bookings k where k.night >= w.ws and k.night < w.ws + 7 and k.status = 'arrived'),
    'no_shows', (select count(*) from public.bookings k where k.night >= w.ws and k.night < w.ws + 7 and k.status = 'no_show'),
    'in_store_end', (
      select count(*) from public.deposit_bottles bt
      join public.deposits d on d.id = bt.deposit_id
      join public.branches b on b.id = d.branch_id and b.active
      left join ex on ex.deposit_id = d.id
      where d.confirmed_at <= least(w.z, now())
        and (bt.consumed_at is null or bt.consumed_at > least(w.z, now()))
        and d.status in ('in_store', 'pending_withdrawal', 'withdrawn', 'expired', 'disposed')
        and not (d.status in ('expired', 'disposed')
                 and coalesce(ex.exp_at, d.collect_deadline_at, d.disposed_at, d.expires_at) <= least(w.z, now())))
  ) order by w.ws) into weeks from w;

  -- bookings per weekday (0 = Monday, as booking_settings.closed_weekdays) over the 56 nights before tonight
  select jsonb_agg(jsonb_build_object(
    'dow', g.dow,
    'bookings', coalesce(c.n, 0),
    'people', coalesce(c.p, 0),
    'closed', coalesce((select bool_and(g.dow = any (bs.closed_weekdays))
                        from public.booking_settings bs join public.branches b on b.id = bs.branch_id and b.active), false)
  ) order by g.dow) into days
  from generate_series(0, 6) as g(dow)
  left join (
    select extract(isodow from k.night)::int - 1 as dow, count(*) as n, sum(k.party_size) as p
    from public.bookings k join public.branches b on b.id = k.branch_id and b.active
    where k.night >= tonight - 56 and k.night < tonight and k.status not in ('cancelled', 'rejected')
    group by 1
  ) c on c.dow = g.dow;

  -- the period's top 5 customers and liquor by bottles deposited (a rejected deposit is not a deposit)
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'deposits', x.n, 'bottles', x.q, 'linked', x.linked)
                            order by x.q desc, x.n desc, x.name), '[]'::jsonb) into people
  from (
    select max(d.customer_name) as name, count(*) as n, sum(d.quantity) as q, bool_or(d.customer_id is not null) as linked
    from public.deposits d
    where d.received_at >= t0 and d.received_at < t1 and d.status <> 'cancelled'
    group by coalesce(d.customer_id::text, nullif(d.customer_phone, ''), lower(d.customer_name))
    order by sum(d.quantity) desc, count(*) desc, max(d.customer_name)
    limit 5
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'deposits', x.n, 'bottles', x.q)
                            order by x.q desc, x.n desc, x.name), '[]'::jsonb) into liquor
  from (
    select d.item_name as name, count(*) as n, sum(d.quantity) as q
    from public.deposits d
    where d.received_at >= t0 and d.received_at < t1 and d.status <> 'cancelled'
    group by d.item_name
    order by sum(d.quantity) desc, count(*) desc, d.item_name
    limit 5
  ) x;

  return jsonb_build_object('from', p_from, 'to', p_to, 'week0', week0, 'tonight', tonight, 'prev', prev,
                            'weeks', weeks, 'weekdays', days, 'top_customers', people, 'top_items', liquor);
end $$;

revoke all on function private.night_start(date) from public, anon;
grant execute on function private.night_start(date) to authenticated, service_role;
revoke all on function public.owner_dashboard() from public, anon;
revoke all on function public.owner_trends(date, date, date, date) from public, anon;
grant execute on function public.owner_dashboard() to authenticated;
grant execute on function public.owner_trends(date, date, date, date) to authenticated;
