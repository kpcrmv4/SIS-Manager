-- P4-01: owner overview + report aggregates. Owner only, computed in SQL (CLAUDE §6 —
-- numbers never come from counting fetched rows). Periods are Bangkok calendar dates,
-- inclusive; timestamps compare against Bangkok midnights (§7).

create or replace function private.bkk_start(p_day date)
returns timestamptz language sql immutable set search_path = '' as $$
  select (p_day::timestamp at time zone 'Asia/Bangkok')
$$;

create or replace function public.owner_overview(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t0 timestamptz; t1 timestamptz; tonight date := private.business_night(now());
  kpi jsonb; rows jsonb; recent jsonb;
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  t0 := private.bkk_start(p_from); t1 := private.bkk_start(p_to + 1);

  select jsonb_build_object(
    'branches', (select count(*) from public.branches where active),
    'in_store_bottles', coalesce((select sum(d.remaining_qty) from public.deposits d join public.branches b on b.id = d.branch_id and b.active
                                  where d.status in ('in_store', 'pending_withdrawal')), 0),
    'in_store_customers', (select count(distinct coalesce(d.customer_id::text, nullif(d.customer_phone, ''), lower(d.customer_name)))
                           from public.deposits d join public.branches b on b.id = d.branch_id and b.active
                           where d.status in ('in_store', 'pending_withdrawal')),
    'new_deposits', (select count(*) from public.deposits where received_at >= t0 and received_at < t1),
    'bottles_withdrawn', coalesce((select sum(qty) from public.withdrawals where status = 'completed' and processed_at >= t0 and processed_at < t1), 0),
    'disposed', (select count(*) from public.deposits where status = 'disposed' and disposed_at >= t0 and disposed_at < t1),
    'awaiting_disposal', (select count(*) from public.deposits d join public.branches b on b.id = d.branch_id and b.active where d.status = 'expired'),
    'bookings', (select count(*) from public.bookings where night between p_from and p_to and status not in ('cancelled', 'rejected')),
    'arrived', (select count(*) from public.bookings where night between p_from and p_to and status = 'arrived'),
    'no_shows', (select count(*) from public.bookings where night between p_from and p_to and status = 'no_show')
  ) into kpi;

  select coalesce(jsonb_agg(r order by r ->> 'name'), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'id', b.id, 'code', b.code, 'name', b.name,
      'in_store_bottles', coalesce((select sum(remaining_qty) from public.deposits where branch_id = b.id and status in ('in_store', 'pending_withdrawal')), 0),
      'to_confirm', (select count(*) from public.deposits where branch_id = b.id and status = 'pending_confirm'),
      'expiring', (select count(*) from public.deposits where branch_id = b.id and status in ('in_store', 'pending_withdrawal') and not is_vip
                   and expires_at is not null and expires_at < private.bkk_start((now() at time zone 'Asia/Bangkok')::date + b.expiry_notice_days + 1)),
      'to_dispose', (select count(*) from public.deposits where branch_id = b.id and status = 'expired'),
      'bookings_tonight', (select count(*) from public.bookings where branch_id = b.id and night = tonight and status in ('pending', 'confirmed', 'arrived')),
      'arrived_tonight', (select count(*) from public.bookings where branch_id = b.id and night = tonight and status = 'arrived')
    ) r
    from public.branches b where b.active
  ) x;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into recent from (
    select jsonb_build_object(
      'id', d.id, 'item', d.item_name, 'customer', d.customer_name, 'branch', b.name,
      'expires_at', d.expires_at, 'disposed_at', d.disposed_at, 'by', p.display_name,
      'notified', exists (select 1 from public.line_outbox o where o.kind = 'disposed' and o.status = 'sent' and o.payload ->> 'deposit_id' = d.id::text)
    ) r
    from public.deposits d
    join public.branches b on b.id = d.branch_id
    left join public.profiles p on p.id = d.disposed_by
    where d.status = 'disposed'
    order by d.disposed_at desc nulls last
    limit 10
  ) y;

  return jsonb_build_object('from', p_from, 'to', p_to, 'night', tonight, 'kpi', kpi, 'branches', rows, 'recent_disposals', recent);
end $$;

create or replace function public.owner_report(p_from date, p_to date, p_branch uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t0 timestamptz; t1 timestamptz; rows jsonb;
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  t0 := private.bkk_start(p_from); t1 := private.bkk_start(p_to + 1);
  select coalesce(jsonb_agg(r order by r ->> 'name'), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'id', b.id, 'code', b.code, 'name', b.name,
      'deposits_new', (select count(*) from public.deposits where branch_id = b.id and received_at >= t0 and received_at < t1),
      'bottles_new', coalesce((select sum(quantity) from public.deposits where branch_id = b.id and received_at >= t0 and received_at < t1), 0),
      'withdrawals', (select count(*) from public.withdrawals where branch_id = b.id and status = 'completed' and processed_at >= t0 and processed_at < t1),
      'bottles_withdrawn', coalesce((select sum(qty) from public.withdrawals where branch_id = b.id and status = 'completed' and processed_at >= t0 and processed_at < t1), 0),
      'expired', (select count(*) from public.deposits where branch_id = b.id and status in ('expired', 'disposed') and collect_deadline_at >= t0 and collect_deadline_at < t1),
      'disposed', (select count(*) from public.deposits where branch_id = b.id and status = 'disposed' and disposed_at >= t0 and disposed_at < t1),
      'bookings', (select count(*) from public.bookings where branch_id = b.id and night between p_from and p_to and status not in ('cancelled', 'rejected')),
      'arrived', (select count(*) from public.bookings where branch_id = b.id and night between p_from and p_to and status = 'arrived'),
      'no_shows', (select count(*) from public.bookings where branch_id = b.id and night between p_from and p_to and status = 'no_show'),
      'cancelled', (select count(*) from public.bookings where branch_id = b.id and night between p_from and p_to and status = 'cancelled')
    ) r
    from public.branches b
    where (p_branch is null or b.id = p_branch)
  ) x;
  return jsonb_build_object('from', p_from, 'to', p_to, 'branches', rows);
end $$;

create index if not exists deposits_disposed_at_idx on public.deposits (disposed_at desc) where status = 'disposed';
create index if not exists deposits_received_at_idx on public.deposits (received_at);
create index if not exists withdrawals_processed_at_idx on public.withdrawals (processed_at) where status = 'completed';
create index if not exists bookings_night_idx on public.bookings (night, status);

revoke all on function private.bkk_start(date) from public, anon;
grant execute on function private.bkk_start(date) to authenticated, service_role;
revoke all on function public.owner_overview(date, date) from public, anon;
revoke all on function public.owner_report(date, date, uuid) from public, anon;
grant execute on function public.owner_overview(date, date) to authenticated;
grant execute on function public.owner_report(date, date, uuid) to authenticated;
