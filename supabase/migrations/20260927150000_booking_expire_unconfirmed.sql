-- R-062 · (owner request) a booking the shop never confirmed is not a no-show. The job every 5 minutes:
--   · still waiting (pending) past its time + no_show_minutes → cancelled, "หมดเวลา · ร้านไม่ได้ยืนยัน",
--     its table released — the show rate counts only bookings the shop took;
--   · confirmed past that time → no_show, as before.
-- Neither tells the customer on LINE (a plain update, not cancel_booking). It looks back 7 nights
-- instead of 2, so a stopped job leaves nothing behind. bar / owner can still mark a waiting booking
-- ไม่มา themselves (mark_booking_no_show, R-054).

create or replace function public.mark_no_shows()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int; m int;
begin
  if not (private.is_service() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.bookings b set status = 'cancelled', cancelled_at = now(), table_id = null,
    cancel_reason = 'หมดเวลา · ร้านไม่ได้ยืนยัน'
  from public.booking_settings s
  where s.branch_id = b.branch_id and b.status = 'pending'
    and b.night >= current_date - 7
    and now() > private.slot_instant(b.night, b.slot_time, s.slot_start) + make_interval(mins => s.no_show_minutes);
  get diagnostics m = row_count;
  update public.bookings b set status = 'no_show', no_show_at = now(), table_id = null
  from public.booking_settings s
  where s.branch_id = b.branch_id and b.status = 'confirmed'
    and b.night >= current_date - 7
    and now() > private.slot_instant(b.night, b.slot_time, s.slot_start) + make_interval(mins => s.no_show_minutes);
  get diagnostics n = row_count;
  return n + m;
end $$;

revoke all on function public.mark_no_shows() from public, anon, authenticated;
