-- R-075 (owner, 2026-09-28): a customer may hand the bottles straight to bar, not through staff.
-- Bar / owner then receive a LINE request and confirm it in one step: the bottles, their levels,
-- the item from the list and the photo, in one transaction. The "bottles to confirm" notice is not
-- sent (the person receiving is the one confirming) — the batch flag of R-068 suppresses it.
create or replace function public.receive_and_confirm(
  p_deposit uuid, p_levels numeric[], p_photo_paths text[], p_item_id uuid default null, p_table text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype;
begin
  select * into d from public.deposits where id = p_deposit;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
  if coalesce(array_length(p_photo_paths, 1), 0) = 0 then raise exception 'PHOTO_REQUIRED' using errcode = '22023'; end if;
  perform set_config('sis.deposit_batch', 'on', true);
  perform public.staff_receive_request(p_deposit, coalesce(array_length(p_levels, 1), 0), p_photo_paths, null, p_item_id, p_table, null);
  perform set_config('sis.deposit_batch', '', true);
  return public.confirm_deposit(p_deposit, p_levels, p_photo_paths, p_item_id);
end $$;
revoke all on function public.receive_and_confirm(uuid, numeric[], text[], uuid, text) from public, anon;
grant execute on function public.receive_and_confirm(uuid, numeric[], text[], uuid, text) to authenticated;
