-- R-076 (owner, 2026-09-28): each disposal is a record with its own number (DSP-<branch>-XXXXX), a
-- reason and photos of the bottles taken off the shelf, who did it and when, and which deposits it
-- took out with how many bottles each. History and the deposit page open it.
create table if not exists public.disposals (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  code text not null unique,
  reason text,
  photo_paths text[] not null default '{}',
  deposit_count integer not null,
  bottle_count integer not null,
  disposed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists disposals_branch_created on public.disposals (branch_id, created_at desc);

create table if not exists public.disposal_items (
  disposal_id uuid not null references public.disposals (id) on delete cascade,
  deposit_id uuid not null references public.deposits (id) on delete cascade,
  bottles integer not null,
  primary key (disposal_id, deposit_id)
);
create index if not exists disposal_items_deposit on public.disposal_items (deposit_id);

alter table public.deposits add column if not exists disposal_id uuid references public.disposals (id) on delete set null;

alter table public.disposals enable row level security;
alter table public.disposal_items enable row level security;
revoke all on public.disposals, public.disposal_items from public, anon, authenticated;
grant select on public.disposals, public.disposal_items to authenticated;
create policy disposals_select on public.disposals for select to authenticated using (branch_id in (select private.my_branch_ids()));
create policy disposal_items_select on public.disposal_items for select to authenticated
  using (exists (select 1 from public.disposals x where x.id = disposal_items.disposal_id and x.branch_id in (select private.my_branch_ids())));

drop function if exists public.dispose_deposits(uuid[], text);
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
    perform private.notify_customer(d.id, 'disposed', '{}'::jsonb, 'disposed:' || d.id);
  end loop;
  return jsonb_build_object('count', changed, 'id', new_id, 'code', new_code, 'bottles', bottles);
end $$;
revoke all on function public.dispose_deposits(uuid[], text, text[]) from public, anon;
grant execute on function public.dispose_deposits(uuid[], text, text[]) to authenticated;
