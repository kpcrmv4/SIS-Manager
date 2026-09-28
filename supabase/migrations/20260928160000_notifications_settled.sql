-- R-077 (owner, 2026-09-28): a notification about work says when the work is done, and by whom —
-- "รับเหล้าแล้ว · โดย สมชาย (staff)" — for everyone who got it, faded and counted as read. Set in
-- the same transaction as the change itself; the bell reloads on the branch broadcast the change
-- already sends, so no extra realtime message is spent.
alter table public.notifications
  add column if not exists handled_at timestamptz,
  add column if not exists handled_action text,
  add column if not exists handled_by uuid references auth.users (id) on delete set null,
  add column if not exists handled_by_name text,
  add column if not exists handled_by_role public.user_role;
create index if not exists notifications_open_subject on public.notifications ((payload ->> 'deposit_id'), kind) where handled_at is null;
create index if not exists notifications_open_booking on public.notifications ((payload ->> 'booking_id'), kind) where handled_at is null;

create or replace function private.settle_notifications(p_kind text, p_key text, p_id text, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare who public.profiles%rowtype;
begin
  select * into who from public.profiles where id = auth.uid();
  update public.notifications set
    handled_at = now(), handled_action = p_action, handled_by = who.id,
    handled_by_name = who.display_name, handled_by_role = who.role,
    read_at = coalesce(read_at, now())
  where kind = p_kind and payload ->> p_key = p_id and handled_at is null;
end $$;
revoke all on function private.settle_notifications(text, text, text, text) from public, anon, authenticated;

create or replace function private.settle_on_deposit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status = 'requested' then
    perform private.settle_notifications('deposit_requested', 'deposit_id', new.id::text, case when new.status = 'cancelled' then 'rejected' else 'received' end);
  end if;
  if old.status = 'pending_confirm' then
    perform private.settle_notifications('deposit_received', 'deposit_id', new.id::text, case when new.status = 'cancelled' then 'rejected' else 'confirmed' end);
  end if;
  return new;
end $$;
revoke all on function private.settle_on_deposit() from public, anon, authenticated;
drop trigger if exists deposits_settle_notifications on public.deposits;
create trigger deposits_settle_notifications after update of status on public.deposits
  for each row execute function private.settle_on_deposit();

-- a withdrawal request is settled when its deposit has no request left waiting
create or replace function private.settle_on_withdrawal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'pending' or new.status = 'pending' then return new; end if;
  if exists (select 1 from public.withdrawals w where w.deposit_id = new.deposit_id and w.status = 'pending') then return new; end if;
  perform private.settle_notifications('deposit_withdrawal_requested', 'deposit_id', new.deposit_id::text,
    case new.status when 'completed' then 'completed' when 'rejected' then 'rejected' else 'cancelled' end);
  return new;
end $$;
revoke all on function private.settle_on_withdrawal() from public, anon, authenticated;
drop trigger if exists withdrawals_settle_notifications on public.withdrawals;
create trigger withdrawals_settle_notifications after update of status on public.withdrawals
  for each row execute function private.settle_on_withdrawal();

create or replace function private.settle_on_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status or old.status <> 'pending' then return new; end if;
  perform private.settle_notifications('booking_pending', 'booking_id', new.id::text, new.status::text);
  return new;
end $$;
revoke all on function private.settle_on_booking() from public, anon, authenticated;
drop trigger if exists bookings_settle_notifications on public.bookings;
create trigger bookings_settle_notifications after update of status on public.bookings
  for each row execute function private.settle_on_booking();
