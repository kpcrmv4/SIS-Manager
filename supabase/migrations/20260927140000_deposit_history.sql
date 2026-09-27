-- R-061 · (owner request) ประวัติฝาก/เบิก — every deposit and withdrawal event of one branch, for
-- every role of that branch (the owner's /audit stays the whole-system log). Read from deposit_events
-- (append-only) with the deposit's code, customer and liquor, and who acted; filtered by a period
-- (business nights, sent as instants), a group of actions, who, and a search on code / name / phone.
-- Also: counts per group, the period's summary (deposits received, bottles withdrawn, disposed) and
-- the people who acted in it, for the filter.

create or replace function private.deposit_event_group(p_action text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_action in ('requested', 'received', 'confirmed', 'rejected', 'cancelled') then 'deposit'
    when p_action in ('withdrawal_requested', 'withdrawal_completed', 'withdrawal_rejected') then 'withdraw'
    when p_action in ('extended', 'expired', 'disposed') then 'expiry'
    else 'other'
  end
$$;
revoke all on function private.deposit_event_group(text) from public, anon;
grant execute on function private.deposit_event_group(text) to authenticated, service_role;

create or replace function public.deposit_history(
  p_branch uuid, p_from timestamptz, p_to timestamptz, p_group text default null, p_actor text default null,
  p_q text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  q text := nullif(btrim(coalesce(p_q, '')), '');
  qd text := nullif(regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g'), '');
  lim int := least(greatest(coalesce(p_limit, 50), 1), 100);
  res jsonb;
begin
  perform private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
  if p_to <= p_from or p_to - p_from > interval '367 days' then raise exception 'BAD_RANGE' using errcode = '22023'; end if;
  if p_group is not null and p_group not in ('deposit', 'withdraw', 'expiry', 'other') then raise exception 'BAD_TYPE' using errcode = '22023'; end if;

  with base as (
    select e.id, e.created_at, e.action, e.payload, e.actor_kind, e.actor_id, e.deposit_id,
      d.code, d.customer_name, d.item_name, private.deposit_event_group(e.action) as grp
    from public.deposit_events e
    join public.deposits d on d.id = e.deposit_id
    where e.branch_id = p_branch and e.created_at >= p_from and e.created_at < p_to
      and (p_actor is null
        or (p_actor = 'customer' and e.actor_kind = 'customer')
        or (p_actor = 'system' and e.actor_kind = 'system')
        or (p_actor ~ '^[0-9a-f-]{36}$' and e.actor_id = p_actor::uuid))
      and (q is null
        or d.code ilike '%' || q || '%'
        or d.customer_name ilike '%' || q || '%'
        or d.item_name ilike '%' || q || '%'
        or (qd is not null and length(qd) >= 4 and private.phone_key(d.customer_phone) like '%' || qd || '%'))
  ), shown as (
    select * from base where p_group is null or grp = p_group
  ), page as (
    select s.*, p.display_name as actor_name, p.role as actor_role
    from shown s left join public.profiles p on p.id = s.actor_id
    order by s.created_at desc, s.id desc
    limit lim offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'at', created_at, 'action', action, 'payload', payload,
        'actor_kind', actor_kind, 'actor_name', actor_name, 'actor_role', actor_role, 'deposit_id', deposit_id,
        'code', code, 'customer', customer_name, 'item', item_name, 'group', grp) order by created_at desc, id desc) from page), '[]'::jsonb),
    'total', (select count(*) from shown),
    'counts', jsonb_build_object(
      'deposit', (select count(*) from base where grp = 'deposit'),
      'withdraw', (select count(*) from base where grp = 'withdraw'),
      'expiry', (select count(*) from base where grp = 'expiry'),
      'other', (select count(*) from base where grp = 'other')),
    'summary', jsonb_build_object(
      -- a LINE request is 'requested' then 'received' when staff take the bottle: count the bottle once
      'received', (select count(*) from base where action = 'received'),
      'withdrawn', (select coalesce(sum(case when jsonb_typeof(payload -> 'bottles') = 'array' then jsonb_array_length(payload -> 'bottles') else 1 end), 0)
                    from base where action = 'withdrawal_completed'),
      'disposed', (select count(*) from base where action = 'disposed')),
    'actors', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'role', p.role) order by p.display_name)
      from public.profiles p where p.id in (select distinct actor_id from public.deposit_events e
        where e.branch_id = p_branch and e.created_at >= p_from and e.created_at < p_to and e.actor_id is not null)), '[]'::jsonb)
  ) into res;
  return res;
end $$;

revoke all on function public.deposit_history(uuid, timestamptz, timestamptz, text, text, text, integer, integer) from public, anon;
grant execute on function public.deposit_history(uuid, timestamptz, timestamptz, text, text, text, integer, integer) to authenticated;
