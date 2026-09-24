-- R-042 · Push by role and the count on the app icon (owner request).
-- 1) Two more kinds of work reach bar / owner: a LINE booking that confirmed itself
--    (booking_new — before, only a booking left waiting told anyone) and a customer cancelling
--    in LINE (booking_cancelled — a table frees up). A cancel from the staff side notifies no one:
--    the person who did it already knows.
-- 2) unread_counts(): each user's unread notifications — the number a push sets on the icon.

create or replace function private.notify_on_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  -- the status is final at insert: staff bookings are confirmed by whoever made them (no one to tell)
  k := case
    when new.status = 'pending' then 'booking_pending'
    when new.status = 'confirmed' and new.source = 'line' then 'booking_new'
  end;
  if k is not null then
    perform private.notify_members(new.branch_id, array['bar', 'owner']::public.user_role[], k,
      jsonb_build_object('booking_id', new.id, 'code', new.code, 'name', new.name, 'party', new.party_size,
        'night', new.night, 'time', to_char(new.slot_time, 'HH24:MI')),
      '/bookings?night=' || new.night);
  end if;
  return new;
end $$;

create or replace function private.notify_on_booking_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.cancelled_by_customer then
    perform private.notify_members(new.branch_id, array['bar', 'owner']::public.user_role[], 'booking_cancelled',
      jsonb_build_object('booking_id', new.id, 'code', new.code, 'name', new.name, 'party', new.party_size,
        'night', new.night, 'time', to_char(new.slot_time, 'HH24:MI')),
      '/bookings?night=' || new.night);
  end if;
  return new;
end $$;
revoke all on function private.notify_on_booking_cancel() from public, anon, authenticated;

create or replace trigger bookings_notify_cancel after update of status on public.bookings
  for each row execute function private.notify_on_booking_cancel();

create or replace function public.unread_counts(p_users uuid[])
returns table (user_id uuid, unread integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
    select n.user_id, count(*)::integer
    from public.notifications n
    where n.user_id = any (p_users) and n.read_at is null
    group by n.user_id;
end $$;
revoke all on function public.unread_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.unread_counts(uuid[]) to service_role;
