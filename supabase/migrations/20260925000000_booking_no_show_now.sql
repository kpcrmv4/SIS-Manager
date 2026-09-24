-- R-053 · ไม่มา · ปล่อยโต๊ะ (owner request): bar or owner may call a late guest a no-show before the
-- automatic mark (no_show_minutes after the slot) and free the table for someone else — as
-- mark_no_shows does, one booking, now. Only a confirmed booking (a waiting one is rejected
-- instead) and only once its time has passed (before that it is a cancellation, not a no-show).
-- A guest who turns up after all can still be checked in: check_in_booking takes a no-show.

create or replace function public.mark_booking_no_show(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; v_start time;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(b.branch_id, array['bar', 'owner']::public.user_role[]);
  if b.status <> 'confirmed' then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  select s.slot_start into v_start from public.booking_settings s where s.branch_id = b.branch_id;
  if now() <= private.slot_instant(b.night, b.slot_time, coalesce(v_start, time '19:00')) then
    raise exception 'NOT_LATE' using errcode = '22023';
  end if;
  update public.bookings set status = 'no_show', no_show_at = now(), table_id = null where id = b.id;
  return jsonb_build_object('id', b.id, 'status', 'no_show');
end $$;

revoke all on function public.mark_booking_no_show(uuid) from public, anon;
grant execute on function public.mark_booking_no_show(uuid) to authenticated;
