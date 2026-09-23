-- P0/P1-01 verify-sprint fixes (security review):
--  · profile guard: trust the database owner (seed / SQL editor), freeze created_at for everyone
--  · login throttle: sign-in runs server-side, so Supabase Auth sees one IP for everybody —
--    our own per-IP and per-identifier failure counter keeps one attacker from locking out the shop

create or replace function private.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  db_owner boolean := auth.uid() is null and current_user in ('postgres', 'supabase_admin');
  trusted boolean := coalesce(auth.role(), '') = 'service_role' or db_owner or private.is_owner();
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'PROFILE_IMMUTABLE' using errcode = '42501';
  end if;
  if not trusted and (new.role is distinct from old.role
                      or new.active is distinct from old.active
                      or new.username is distinct from old.username) then
    raise exception 'OWNER_ONLY' using errcode = '42501';
  end if;
  if old.id = auth.uid() and (new.role is distinct from old.role or new.active is distinct from old.active)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'CANNOT_CHANGE_OWN_ROLE' using errcode = '42501';
  end if;
  return new;
end $$;

-- branches_select: `(select private.is_member(id))` is correlated with the row, so it was
-- evaluated per row anyway; the uncorrelated set is computed once per statement
drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated
  using (id in (select private.my_branch_ids()));

create table if not exists private.login_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  identifier text not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_ip_idx on private.login_attempts (ip, created_at desc) where not ok;
create index if not exists login_attempts_ident_idx on private.login_attempts (identifier, created_at desc) where not ok;
revoke all on private.login_attempts from public, anon, authenticated;

-- 15-minute window: 20 failures per IP or 8 per identifier → blocked
create or replace function public.login_throttle(p_ip text, p_identifier text)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from private.login_attempts
      where ip = p_ip and not ok and created_at > now() - interval '15 minutes') >= 20
    or
    (select count(*) from private.login_attempts
      where identifier = lower(p_identifier) and not ok and created_at > now() - interval '15 minutes') >= 8
$$;

create or replace function public.login_record(p_ip text, p_identifier text, p_ok boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.login_attempts (ip, identifier, ok) values (left(p_ip, 64), lower(left(p_identifier, 254)), p_ok);
  -- a success clears that identifier's failures so a typo streak does not linger
  if p_ok then delete from private.login_attempts where identifier = lower(left(p_identifier, 254)) and not ok; end if;
  -- keep the table small without a job: drop anything older than a day, a few rows at a time
  delete from private.login_attempts where id in (
    select id from private.login_attempts where created_at < now() - interval '1 day' limit 100);
end $$;

revoke all on function public.login_throttle(text, text) from public, anon, authenticated;
revoke all on function public.login_record(text, text, boolean) from public, anon, authenticated;
grant execute on function public.login_throttle(text, text) to service_role;
grant execute on function public.login_record(text, text, boolean) to service_role;
