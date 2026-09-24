-- R-054 · ไม่มา · ปล่อยโต๊ะ takes a waiting booking too. Where customers pick their own table
-- (table_choice = customer) a booking still waiting for the shop already holds its table, and a
-- guest who never comes kept it until the automatic mark — ปฏิเสธ would tell them on LINE the shop
-- turned them down, which isn't what happened. mark_no_shows has always counted a late waiting
-- booking a no-show; bar or owner may now do the same sooner. Still only once its time has passed.

create or replace function public.mark_booking_no_show(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; v_start time;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(b.branch_id, array['bar', 'owner']::public.user_role[]);
  if b.status not in ('pending', 'confirmed') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  select s.slot_start into v_start from public.booking_settings s where s.branch_id = b.branch_id;
  if now() <= private.slot_instant(b.night, b.slot_time, coalesce(v_start, time '19:00')) then
    raise exception 'NOT_LATE' using errcode = '22023';
  end if;
  update public.bookings set status = 'no_show', no_show_at = now(), table_id = null where id = b.id;
  return jsonb_build_object('id', b.id, 'status', 'no_show');
end $$;

revoke all on function public.mark_booking_no_show(uuid) from public, anon;
grant execute on function public.mark_booking_no_show(uuid) to authenticated;
