-- R-039 · Cancelling a booking from the staff side is bar / owner work (owner request), like
-- confirming and rejecting one; the customer's own cancel inside the window is unchanged.
-- Only the role list of the staff path changes (staff → BAR_ONLY).

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
    perform private.require_role(b.branch_id, array['bar', 'owner']::public.user_role[]);
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
