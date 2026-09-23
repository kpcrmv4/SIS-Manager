-- P1 correctness review: confirm_booking takes the branch-night lock before the table check
-- (a race otherwise surfaces as a raw 23505 instead of table_taken), and check-in by code
-- prefers tonight's booking over a same-code booking on another night.

create or replace function public.confirm_booking(p_booking uuid, p_table uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(b.branch_id, array['bar', 'owner']::public.user_role[]);
  if b.status <> 'pending' then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if p_table is not null then
    if not exists (select 1 from public.tables where id = p_table and branch_id = b.branch_id and active) then raise exception 'BAD_TABLE' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtext(b.branch_id::text || b.night::text));
    if not private.table_free(p_table, b.night, b.id) then raise exception 'table_taken' using errcode = '22023'; end if;
  end if;
  update public.bookings set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
    table_id = coalesce(p_table, table_id)
  where id = b.id;
  perform private.notify_booking(b.id, 'booking_confirmed', '{}'::jsonb, 'booking_confirmed:' || b.id);
  return jsonb_build_object('id', b.id, 'status', 'confirmed');
end $$;

create or replace function public.check_in_booking(p_branch uuid, p_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; ref text := btrim(coalesce(p_ref, '')); tonight date := private.business_night(now());
begin
  perform private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
  select * into b from public.bookings where qr_token = lower(ref) for update;
  if not found then
    select * into b from public.bookings where branch_id = p_branch and code = upper(ref)
    order by (night = tonight) desc, night desc limit 1 for update;
  end if;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if b.branch_id <> p_branch then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if b.night <> tonight then raise exception 'WRONG_NIGHT' using errcode = '22023'; end if;
  if b.status = 'arrived' then return jsonb_build_object('id', b.id, 'status', 'arrived', 'already', true); end if;
  if b.status not in ('pending', 'confirmed', 'no_show') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  update public.bookings set status = 'arrived', arrived_at = now(), checked_in_by = auth.uid(),
    confirmed_at = coalesce(confirmed_at, now()), no_show_at = null
  where id = b.id;
  return jsonb_build_object('id', b.id, 'status', 'arrived', 'already', false);
end $$;
