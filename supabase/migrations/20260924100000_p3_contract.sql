-- P3 contract (orchestrator, before the LINE / print fan-out):
--   1. binding a branch's LINE staff group with a short-lived code the owner generates
--   2. the typed link-code flow with a per-LINE-user failure throttle
--   3. an owner "send a test message" helper for /settings/line

-- ── 1. staff group binding ─────────────────────────────────────────────
-- The owner makes a code in /settings/line and types it in the LINE group the bot was
-- invited to; the webhook (service role) calls bind_staff_group with that group's id.
-- Any group can invite the bot, so without the code a stranger's group could receive
-- the staff notifications.
alter table public.branch_line_secrets
  add column if not exists group_bind_code text,
  add column if not exists group_bind_expires_at timestamptz;

create or replace function public.new_group_bind_code(p_branch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c text := 'SIS-' || lpad((floor(random() * 1000000))::int::text, 6, '0'); exp timestamptz := now() + interval '15 minutes';
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.branches where id = p_branch) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.branch_line_secrets (branch_id, group_bind_code, group_bind_expires_at)
  values (p_branch, c, exp)
  on conflict (branch_id) do update set group_bind_code = excluded.group_bind_code, group_bind_expires_at = excluded.group_bind_expires_at;
  return jsonb_build_object('code', c, 'expires_at', exp);
end $$;

create or replace function public.bind_staff_group(p_branch uuid, p_code text, p_group_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(btrim(p_group_id), '') = '' then return false; end if;
  update public.branch_line_secrets set group_bind_code = null, group_bind_expires_at = null
  where branch_id = p_branch and group_bind_code = upper(btrim(coalesce(p_code, ''))) and group_bind_expires_at > now();
  if not found then return false; end if;
  update public.branches set staff_group_id = btrim(p_group_id) where id = p_branch;
  return true;
end $$;

-- ── 2. typed link code with a failure throttle ───────────────────────
create table if not exists public.line_link_failures (
  id bigint generated always as identity primary key,
  branch_id uuid not null references public.branches (id) on delete cascade,
  line_user_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists line_link_failures_lookup on public.line_link_failures (branch_id, line_user_id, created_at desc);
alter table public.line_link_failures enable row level security;
revoke all on public.line_link_failures from anon, authenticated;
-- no policies: service role only

-- 5 wrong codes per LINE user per branch in 15 minutes → THROTTLED. A failure never raises
-- (that would roll back its own failure row); the result says ok true / false + error code.
create or replace function public.line_link_attempt(p_branch uuid, p_customer_id uuid, p_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lu text; loc public.app_locale; fails int; res jsonb; d public.deposits%rowtype;
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select line_user_id, locale into lu, loc from public.customers where id = p_customer_id;
  if lu is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
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

-- ── 3. owner test message ────────────────────────────────────────────
-- Enqueues one 'test' message to the branch's staff group through the normal outbox, so
-- the owner can prove token + group binding end to end from /settings/line.
create or replace function public.send_line_test(p_branch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g text; k text := 'test:' || p_branch || ':' || extract(epoch from now())::bigint;
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select staff_group_id into g from public.branches where id = p_branch;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if coalesce(g, '') = '' then raise exception 'NO_GROUP' using errcode = '22023'; end if;
  perform private.enqueue_line(p_branch, 'group', g, 'test', 'th', jsonb_build_object('at', now()), k);
  return jsonb_build_object('queued', true);
end $$;

revoke all on function public.new_group_bind_code(uuid) from public, anon;
revoke all on function public.bind_staff_group(uuid, text, text) from public, anon, authenticated;
revoke all on function public.line_link_attempt(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.send_line_test(uuid) from public, anon;
grant execute on function public.new_group_bind_code(uuid) to authenticated;
grant execute on function public.bind_staff_group(uuid, text, text) to service_role;
grant execute on function public.line_link_attempt(uuid, uuid, text) to service_role;
grant execute on function public.send_line_test(uuid) to authenticated;
