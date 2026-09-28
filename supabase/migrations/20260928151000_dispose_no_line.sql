-- R-076 (owner, 2026-09-28): disposing no longer messages the customer in LINE — the shop decided
-- the expiry notices are enough. The switch leaves the owner's LINE settings too.
create or replace function public.dispose_deposits(p_deposit_ids uuid[], p_reason text default null, p_photo_paths text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n int := coalesce(array_length(p_deposit_ids, 1), 0);
  d record; changed int; b uuid; bottles int; new_id uuid; new_code text; tries int := 0;
begin
  if n = 0 or n > 200 then raise exception 'BAD_COUNT' using errcode = '22023'; end if;
  for d in select id, branch_id, status from public.deposits where id = any (p_deposit_ids) order by id for update loop
    perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
    if d.status <> 'expired' then raise exception 'NOT_EXPIRED' using errcode = '22023'; end if;
    if b is not null and b <> d.branch_id then raise exception 'BAD_BRANCH' using errcode = '22023'; end if;
    b := d.branch_id;
  end loop;
  if b is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if coalesce(array_length(p_photo_paths, 1), 0) = 0 or not private.photos_valid(b, p_photo_paths) then
    raise exception 'PHOTO_REQUIRED' using errcode = '22023';
  end if;
  select coalesce(sum(remaining_qty), 0) into bottles from public.deposits where id = any (p_deposit_ids);

  loop
    tries := tries + 1;
    new_code := 'DSP-' || substr(private.new_deposit_code(b), 5);
    begin
      insert into public.disposals (branch_id, code, reason, photo_paths, deposit_count, bottle_count, disposed_by)
      values (b, new_code, nullif(btrim(p_reason), ''), p_photo_paths, n, bottles, auth.uid())
      returning id into new_id;
      exit;
    exception when unique_violation then
      if tries >= 8 then raise exception 'CODE_EXHAUSTED'; end if;
    end;
  end loop;
  insert into public.disposal_items (disposal_id, deposit_id, bottles)
  select new_id, id, remaining_qty from public.deposits where id = any (p_deposit_ids);

  update public.deposits set status = 'disposed', disposed_by = auth.uid(), disposed_at = now(),
    dispose_reason = nullif(btrim(p_reason), ''), disposal_id = new_id
  where id = any (p_deposit_ids) and status = 'expired';
  get diagnostics changed = row_count;
  if changed <> n then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  for d in select id, branch_id from public.deposits where id = any (p_deposit_ids) loop
    perform private.log_event(d.id, d.branch_id, 'disposed', jsonb_build_object('reason', p_reason, 'disposal_id', new_id, 'disposal_code', new_code));
  end loop;
  return jsonb_build_object('count', changed, 'id', new_id, 'code', new_code, 'bottles', bottles);
end $$;
