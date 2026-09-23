-- P3/P4 verify sprint — security + performance review fixes.

-- ── 1. staff-group bind code: CSPRNG, 8 chars of the link alphabet, 10 wrong tries clear it ─
alter table public.branch_line_secrets add column if not exists group_bind_failures integer not null default 0;

create or replace function private.random_code(p_len integer)
returns text language plpgsql volatile set search_path = '' as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(p_len); s text := ''; i int;
begin
  -- 256 is a multiple of 32, so byte % 32 is uniform over the alphabet
  for i in 0..p_len - 1 loop s := s || substr(alphabet, 1 + (get_byte(b, i) % 32), 1); end loop;
  return s;
end $$;
revoke all on function private.random_code(integer) from public, anon, authenticated;

create or replace function public.new_group_bind_code(p_branch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c text := 'SIS-' || private.random_code(8); exp timestamptz := now() + interval '15 minutes';
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.branches where id = p_branch) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.branch_line_secrets (branch_id, group_bind_code, group_bind_expires_at, group_bind_failures)
  values (p_branch, c, exp, 0)
  on conflict (branch_id) do update set group_bind_code = excluded.group_bind_code, group_bind_expires_at = excluded.group_bind_expires_at, group_bind_failures = 0;
  return jsonb_build_object('code', c, 'expires_at', exp);
end $$;

create or replace function public.bind_staff_group(p_branch uuid, p_code text, p_group_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.branch_line_secrets%rowtype;
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(btrim(p_group_id), '') = '' then return false; end if;
  select * into s from public.branch_line_secrets where branch_id = p_branch for update;
  if not found or s.group_bind_code is null or s.group_bind_expires_at <= now() then return false; end if;
  if s.group_bind_code <> upper(btrim(coalesce(p_code, ''))) then
    -- a wrong guess while a code is open; 10 of them burn the code (the owner makes a new one)
    update public.branch_line_secrets
    set group_bind_failures = s.group_bind_failures + 1,
        group_bind_code = case when s.group_bind_failures + 1 >= 10 then null else group_bind_code end,
        group_bind_expires_at = case when s.group_bind_failures + 1 >= 10 then null else group_bind_expires_at end
    where branch_id = p_branch;
    return false;
  end if;
  update public.branch_line_secrets set group_bind_code = null, group_bind_expires_at = null, group_bind_failures = 0 where branch_id = p_branch;
  update public.branches set staff_group_id = btrim(p_group_id) where id = p_branch;
  return true;
end $$;

-- ── 2. link-code throttle: serialise attempts per (branch, LINE user) ─────────────
create or replace function public.line_link_attempt(p_branch uuid, p_customer_id uuid, p_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lu text; loc public.app_locale; fails int; res jsonb; d public.deposits%rowtype;
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select line_user_id, locale into lu, loc from public.customers where id = p_customer_id;
  if lu is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- concurrent webhook events of one user would otherwise all read the same failure count
  perform pg_advisory_xact_lock(hashtextextended(p_branch::text || ':' || lu, 0));
  delete from public.line_link_failures where branch_id = p_branch and line_user_id = lu and created_at < now() - interval '1 day';
  select count(*) into fails from public.line_link_failures
  where branch_id = p_branch and line_user_id = lu and created_at > now() - interval '15 minutes';
  if fails >= 5 then return jsonb_build_object('ok', false, 'error', 'THROTTLED'); end if;
  begin
    res := public.link_deposit_customer(p_branch, p_ref, p_customer_id);
  exception when others then
    insert into public.line_link_failures (branch_id, line_user_id) values (p_branch, lu);
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  select * into d from public.deposits where id = (res ->> 'id')::uuid;
  return jsonb_build_object('ok', true, 'deposit_id', d.id, 'code', d.code, 'item', d.item_name,
    'remaining', d.remaining_qty, 'quantity', d.quantity, 'expires_at', d.expires_at, 'is_vip', d.is_vip,
    'status', d.status, 'locale', loc);
end $$;

-- ── 3. owner overview: "แจ้ง LINE แล้ว" looks up sent disposal messages by deposit ─
create index if not exists line_outbox_disposed_sent_idx on public.line_outbox ((payload ->> 'deposit_id'))
  where kind = 'disposed' and status = 'sent';

revoke all on function public.new_group_bind_code(uuid) from public, anon;
revoke all on function public.bind_staff_group(uuid, text, text) from public, anon, authenticated;
revoke all on function public.line_link_attempt(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.new_group_bind_code(uuid) to authenticated;
grant execute on function public.bind_staff_group(uuid, text, text) to service_role;
grant execute on function public.line_link_attempt(uuid, uuid, text) to service_role;
