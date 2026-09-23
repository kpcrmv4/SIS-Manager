-- P1 verify-sprint hardening (security + performance review of P1-02..P1-05).

-- ── 1. linking a LINE account needs the receipt's secret token, not the code on the label ─
alter table public.deposits add column if not exists link_token text not null default encode(extensions.gen_random_bytes(16), 'hex');
create unique index if not exists deposits_link_token_uniq on public.deposits (link_token);

drop function if exists public.link_deposit_customer(text, uuid);
create or replace function public.link_deposit_customer(p_branch uuid, p_token text, p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype;
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into d from public.deposits where link_token = lower(btrim(coalesce(p_token, ''))) and branch_id = p_branch for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if d.customer_id is not null and d.customer_id <> p_customer_id then raise exception 'NOT_YOURS' using errcode = '42501'; end if;
  if d.status in ('withdrawn', 'disposed', 'cancelled') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if d.customer_id is null then
    update public.deposits set customer_id = p_customer_id where id = d.id;
    insert into public.deposit_events (deposit_id, branch_id, actor_kind, action) values (d.id, d.branch_id, 'customer', 'line_linked');
  end if;
  return jsonb_build_object('id', d.id, 'code', d.code, 'branch_id', d.branch_id);
end $$;
revoke all on function public.link_deposit_customer(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.link_deposit_customer(uuid, text, uuid) to service_role;

-- ── 2. staff may not attach a customer: only the verified LINE flow (service role) does ─
create or replace function private.guard_staff_customer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.customer_id is not null and new.source::text = 'staff' and not private.is_service() and auth.role() is not null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists deposits_staff_customer on public.deposits;
create trigger deposits_staff_customer before insert on public.deposits for each row execute function private.guard_staff_customer();
drop trigger if exists bookings_staff_customer on public.bookings;
create trigger bookings_staff_customer before insert on public.bookings for each row execute function private.guard_staff_customer();
revoke all on function private.guard_staff_customer() from public, anon;
grant execute on function private.guard_staff_customer() to authenticated, service_role;

-- ── 3. photo paths must be real objects in the deposit's own branch folder ─
create or replace function private.photos_valid(p_branch uuid, p_paths text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(bool_and(
    private.storage_branch(p) = p_branch
    and exists (select 1 from storage.objects o where o.bucket_id = 'deposit-photos' and o.name = p)
  ), true)
  from unnest(coalesce(p_paths, '{}')) as p
$$;

create or replace function private.guard_deposit_photos()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_service() or auth.role() is null then return new; end if;
  if tg_op = 'INSERT' or new.photo_paths is distinct from old.photo_paths then
    if not private.photos_valid(new.branch_id, new.photo_paths) then raise exception 'PHOTO_REQUIRED' using errcode = '22023'; end if;
  end if;
  if tg_op = 'INSERT' or new.confirm_photo_paths is distinct from old.confirm_photo_paths then
    if not private.photos_valid(new.branch_id, new.confirm_photo_paths) then raise exception 'PHOTO_REQUIRED' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
drop trigger if exists deposits_photos_guard on public.deposits;
create trigger deposits_photos_guard before insert or update of photo_paths, confirm_photo_paths on public.deposits
  for each row execute function private.guard_deposit_photos();

create or replace function private.guard_withdrawal_photo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_service() or auth.role() is null or new.photo_path is null then return new; end if;
  if tg_op = 'UPDATE' and new.photo_path is not distinct from old.photo_path then return new; end if;
  if not private.photos_valid(new.branch_id, array[new.photo_path]) then raise exception 'PHOTO_REQUIRED' using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists withdrawals_photo_guard on public.withdrawals;
create trigger withdrawals_photo_guard before insert or update of photo_path on public.withdrawals
  for each row execute function private.guard_withdrawal_photo();

revoke all on function private.photos_valid(uuid, text[]) from public, anon, authenticated;
revoke all on function private.guard_deposit_photos() from public, anon;
revoke all on function private.guard_withdrawal_photo() from public, anon;
grant execute on function private.guard_deposit_photos() to authenticated, service_role;
grant execute on function private.guard_withdrawal_photo() to authenticated, service_role;

-- ── 4. the expiry/VIP guard: a trigger under a definer RPC sees current_user = postgres,
--       so trust only a missing JWT (direct DB connection) or the service role ─
create or replace function private.guard_deposit_expiry_vip()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'requested' and new.is_vip is not distinct from old.is_vip then return new; end if;
  if (new.expires_at is distinct from old.expires_at or new.is_vip is distinct from old.is_vip)
     and auth.role() is not null
     and auth.role() <> 'service_role'
     and coalesce(private.current_role()::text, '') not in ('bar', 'owner') then
    raise exception 'BAR_ONLY' using errcode = '42501';
  end if;
  return new;
end $$;

-- ── 5. print jobs are built by the database from the deposit, never from a client payload ─
drop policy if exists print_jobs_insert on public.print_jobs;
revoke insert on public.print_jobs from authenticated;

create or replace function public.queue_print(p_deposit uuid, p_type text, p_copies integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; b public.branches%rowtype; job uuid; who text; copies int;
begin
  select * into d from public.deposits where id = p_deposit;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['staff', 'bar', 'owner']::public.user_role[]);
  if p_type not in ('receipt', 'label') then raise exception 'BAD_TYPE' using errcode = '22023'; end if;
  if d.status in ('requested', 'cancelled') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  select * into b from public.branches where id = d.branch_id;
  select display_name into who from public.profiles where id = d.received_by;
  copies := greatest(1, least(coalesce(p_copies, (b.receipt_settings ->> 'copies')::int, 1), 5));
  insert into public.print_jobs (branch_id, deposit_id, type, copies, payload, requested_by)
  values (d.branch_id, d.id, p_type, copies, jsonb_build_object(
    'code', d.code, 'link_token', case when p_type = 'receipt' then d.link_token end,
    'branch_code', b.code, 'branch_name', b.name, 'liff_id', b.liff_id,
    'header', b.receipt_settings ->> 'header', 'footer', b.receipt_settings ->> 'footer',
    'customer_name', d.customer_name, 'customer_phone', d.customer_phone, 'table', d.table_label,
    'item', d.item_name, 'quantity', d.quantity, 'remaining', d.remaining_qty, 'is_vip', d.is_vip,
    'expires_at', d.expires_at, 'deadline', d.collect_deadline_at, 'received_at', coalesce(d.received_at, d.created_at),
    'received_by', who), auth.uid())
  returning id into job;
  perform private.log_event(d.id, d.branch_id, 'printed', jsonb_build_object('type', p_type));
  return jsonb_build_object('id', job);
end $$;
revoke all on function public.queue_print(uuid, text, integer) from public, anon;
grant execute on function public.queue_print(uuid, text, integer) to authenticated;

-- ── 6. customer (service-role) paths must name the branch the request came through ─
drop function if exists public.request_withdrawal(uuid, uuid[], public.withdrawal_type, text, text, uuid);
create or replace function public.request_withdrawal(
  p_deposit uuid, p_bottle_ids uuid[], p_type public.withdrawal_type,
  p_table text default null, p_notes text default null, p_customer_id uuid default null, p_branch uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.deposits%rowtype;
  n int;
  blocked text[];
  night date;
  by_cust boolean := false;
  ids uuid[];
begin
  select * into d from public.deposits where id = p_deposit for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if private.is_service() then
    if p_customer_id is null or d.customer_id is distinct from p_customer_id or p_branch is distinct from d.branch_id then
      raise exception 'NOT_YOURS' using errcode = '42501';
    end if;
    by_cust := true;
  else
    perform private.require_role(d.branch_id, array['staff', 'bar', 'owner']::public.user_role[]);
  end if;
  if d.status not in ('in_store', 'pending_withdrawal') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  n := coalesce(array_length(p_bottle_ids, 1), 0);
  if n = 0 then raise exception 'NO_BOTTLES' using errcode = '22023'; end if;
  if (select count(*) from public.deposit_bottles b where b.deposit_id = d.id and b.id = any (p_bottle_ids) and b.status <> 'consumed') <> n then
    raise exception 'BAD_BOTTLES' using errcode = '22023';
  end if;
  if p_type = 'in_store' then
    select withdrawal_blocked_days into blocked from public.branches where id = d.branch_id;
    night := private.business_night(now());
    if private.dow_name(night) = any (blocked) then raise exception 'WITHDRAW_BLOCKED_DAY' using errcode = '22023'; end if;
  end if;

  with ins as (
    insert into public.withdrawals (deposit_id, branch_id, bottle_id, type, by_customer, customer_id, requested_by, table_label, notes)
    select d.id, d.branch_id, b, p_type, by_cust, case when by_cust then p_customer_id end,
      case when by_cust then null else auth.uid() end, nullif(btrim(p_table), ''), nullif(btrim(p_notes), '')
    from unnest(p_bottle_ids) as b
    returning id
  )
  select array_agg(id) into ids from ins;

  perform private.refresh_deposit(d.id);
  perform private.log_event(d.id, d.branch_id, 'withdrawal_requested',
    jsonb_build_object('count', n, 'type', p_type, 'table', p_table), case when by_cust then 'customer' else 'staff' end);
  perform private.notify_staff_group(d.branch_id, 'withdrawal_requested',
    jsonb_build_object('deposit_id', d.id, 'code', d.code, 'item', d.item_name, 'customer', d.customer_name,
      'count', n, 'table', p_table, 'type', p_type), 'withdrawal_requested:' || ids[1]);
  return jsonb_build_object('deposit_id', d.id, 'withdrawal_ids', to_jsonb(ids));
exception when unique_violation then
  raise exception 'ALREADY_REQUESTED' using errcode = '23505';
end $$;
revoke all on function public.request_withdrawal(uuid, uuid[], public.withdrawal_type, text, text, uuid, uuid) from public, anon;
grant execute on function public.request_withdrawal(uuid, uuid[], public.withdrawal_type, text, text, uuid, uuid) to authenticated, service_role;

drop function if exists public.cancel_booking(uuid, text, uuid);
create or replace function public.cancel_booking(p_booking uuid, p_reason text default null, p_customer_id uuid default null, p_branch uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; s public.booking_settings%rowtype; by_cust boolean := false;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if private.is_service() then
    if p_customer_id is null or b.customer_id is distinct from p_customer_id or p_branch is distinct from b.branch_id then
      raise exception 'NOT_YOURS' using errcode = '42501';
    end if;
    by_cust := true;
  else
    perform private.require_role(b.branch_id, array['staff', 'bar', 'owner']::public.user_role[]);
  end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if by_cust then
    select * into s from public.booking_settings where branch_id = b.branch_id;
    if now() > private.slot_instant(b.night, b.slot_time, s.slot_start) - make_interval(hours => s.customer_cancel_hours) then
      raise exception 'cancel_too_late' using errcode = '22023';
    end if;
  end if;
  update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), ''),
    cancelled_by_customer = by_cust, table_id = null
  where id = b.id;
  perform private.notify_booking(b.id, 'booking_cancelled', '{}'::jsonb, 'booking_cancelled:' || b.id);
  return jsonb_build_object('id', b.id, 'status', 'cancelled');
end $$;
revoke all on function public.cancel_booking(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.cancel_booking(uuid, text, uuid, uuid) to authenticated, service_role;

-- ── 7. performance: uncorrelated branch set in the deposit-side policies ─
drop policy if exists deposits_select on public.deposits;
create policy deposits_select on public.deposits for select to authenticated
  using (branch_id in (select private.my_branch_ids()));
drop policy if exists deposit_bottles_select on public.deposit_bottles;
create policy deposit_bottles_select on public.deposit_bottles for select to authenticated
  using (deposit_id in (select d.id from public.deposits d where d.branch_id in (select private.my_branch_ids())));
drop policy if exists withdrawals_select on public.withdrawals;
create policy withdrawals_select on public.withdrawals for select to authenticated
  using (branch_id in (select private.my_branch_ids()));
drop policy if exists deposit_events_select on public.deposit_events;
create policy deposit_events_select on public.deposit_events for select to authenticated
  using (branch_id in (select private.my_branch_ids()));
drop policy if exists customers_select_member on public.customers;
create policy customers_select_member on public.customers for select to authenticated
  using (exists (select 1 from public.deposits d where d.customer_id = customers.id and d.branch_id in (select private.my_branch_ids())));

-- cron-scan indexes (no branch predicate in these jobs)
create index if not exists deposits_expiry_notice_idx on public.deposits (expires_at)
  where status in ('in_store', 'pending_withdrawal') and not is_vip and expiry_notice_sent_at is null;
create index if not exists deposits_due_idx on public.deposits (collect_deadline_at) where status = 'in_store' and not is_vip;
drop index if exists public.line_outbox_due_idx;
create index if not exists line_outbox_due_idx on public.line_outbox (next_attempt_at) where status in ('queued', 'failed', 'sending');

-- retention: terminal outbox rows after 30 days, read notifications after 90 days
create or replace function private.retention()
returns void language sql security definer set search_path = '' as $$
  delete from public.line_outbox where created_at < now() - interval '30 days'
    and (status in ('sent', 'skipped') or (status = 'failed' and attempts >= 6));
  delete from public.notifications where read_at is not null and read_at < now() - interval '90 days';
$$;
revoke all on function private.retention() from public, anon, authenticated;
select cron.unschedule('sis-retention') where exists (select 1 from cron.job where jobname = 'sis-retention');
select cron.schedule('sis-retention', '30 20 * * *', 'select private.retention()');
