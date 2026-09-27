-- R-060 · (owner request) bar confirms the bottle against the shop's list. Staff and customers type
-- the liquor name however they like; when bar confirms, the deposit takes one active item of the
-- branch (or an all-branch one): the one bar picked, else the one it already carries, else an exact
-- (case- and space-insensitive) name match. None → ITEM_REQUIRED, and the dialog says ไม่เจอชื่อเหล้า
-- with เพิ่มรายชื่อเหล้า — bar and owner may add a name to their own branch's list for that
-- (add_liquor_item), which reuses an existing name instead of making a second one.
-- The deposit's item_name / category become the item's; the name that was typed stays in the event.

drop function if exists public.confirm_deposit(uuid, numeric[], text[]);
create or replace function public.confirm_deposit(p_deposit uuid, p_levels numeric[], p_photo_paths text[], p_item_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; st public.deposit_status; i int; lvl numeric; it public.liquor_items%rowtype;
begin
  select * into d from public.deposits where id = p_deposit for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
  if d.status <> 'pending_confirm' then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if coalesce(array_length(p_levels, 1), 0) <> d.quantity then raise exception 'LEVELS_MISMATCH' using errcode = '22023'; end if;
  if coalesce(array_length(p_photo_paths, 1), 0) = 0 then raise exception 'PHOTO_REQUIRED' using errcode = '22023'; end if;

  -- the item: bar's pick, else the one on the deposit, else the typed name exactly — active, and this branch's or everyone's
  select * into it from public.liquor_items l
  where l.id = coalesce(p_item_id, d.item_id) and l.active and (l.branch_id is null or l.branch_id = d.branch_id);
  if it.id is null and p_item_id is null then
    select * into it from public.liquor_items l
    where l.active and (l.branch_id is null or l.branch_id = d.branch_id)
      and lower(regexp_replace(btrim(l.name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(d.item_name), '\s+', ' ', 'g'))
    order by l.branch_id nulls last, l.sort limit 1;
  end if;
  if it.id is null then raise exception 'ITEM_REQUIRED' using errcode = '22023'; end if;

  for i in 1..d.quantity loop
    lvl := p_levels[i];
    if lvl is null or lvl < 0 or lvl > 100 then raise exception 'BAD_LEVEL' using errcode = '22023'; end if;
    update public.deposit_bottles set remaining_percent = lvl,
      status = case when lvl = 0 then 'consumed'::public.bottle_status when lvl < 100 then 'opened' else 'sealed' end,
      consumed_at = case when lvl = 0 then now() end, consumed_by = case when lvl = 0 then auth.uid() end
    where deposit_id = d.id and bottle_no = i;
  end loop;

  update public.deposits set confirmed_by = auth.uid(), confirmed_at = now(), confirm_photo_paths = p_photo_paths,
    item_id = it.id, item_name = it.name, category = it.category
  where id = d.id;
  st := private.refresh_deposit(d.id);
  perform private.log_event(d.id, d.branch_id, 'confirmed', jsonb_build_object('levels', to_jsonb(p_levels))
    || case when d.item_name is distinct from it.name then jsonb_build_object('item', it.name, 'typed', d.item_name) else '{}'::jsonb end);
  perform private.notify_customer(d.id, 'deposit_confirmed', '{}'::jsonb, 'deposit_confirmed:' || d.id);
  return jsonb_build_object('id', d.id, 'status', st, 'item', it.name);
end $$;

-- ── bar / owner: a liquor name the list is missing, added to their branch from the confirm dialog ─
create or replace function public.add_liquor_item(p_branch uuid, p_name text, p_category text default 'other')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare nm text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'); it public.liquor_items%rowtype;
begin
  perform private.require_role(p_branch, array['bar', 'owner']::public.user_role[]);
  if length(nm) not between 1 and 120 then raise exception 'BAD_NAME' using errcode = '22023'; end if;
  if p_category not in ('whisky', 'brandy', 'vodka', 'gin', 'rum', 'tequila', 'wine', 'other') then raise exception 'BAD_TYPE' using errcode = '22023'; end if;
  -- the same name already on the list (this branch's or everyone's) is reused, and switched back on
  perform pg_advisory_xact_lock(hashtextextended('liquor_item:' || p_branch::text || ':' || lower(nm), 0));
  select * into it from public.liquor_items l
  where (l.branch_id is null or l.branch_id = p_branch) and lower(regexp_replace(btrim(l.name), '\s+', ' ', 'g')) = lower(nm)
  order by l.active desc, l.branch_id nulls last limit 1;
  if it.id is not null then
    if not it.active and it.branch_id = p_branch then update public.liquor_items set active = true where id = it.id; end if;
    if it.active or it.branch_id = p_branch then
      return jsonb_build_object('id', it.id, 'name', it.name, 'category', it.category, 'existed', true);
    end if;
  end if;
  insert into public.liquor_items (branch_id, name, category) values (p_branch, nm, p_category) returning * into it;
  return jsonb_build_object('id', it.id, 'name', it.name, 'category', it.category, 'existed', false);
end $$;

revoke all on function public.confirm_deposit(uuid, numeric[], text[], uuid) from public, anon;
revoke all on function public.add_liquor_item(uuid, text, text) from public, anon;
grant execute on function public.confirm_deposit(uuid, numeric[], text[], uuid) to authenticated;
grant execute on function public.add_liquor_item(uuid, text, text) to authenticated;
