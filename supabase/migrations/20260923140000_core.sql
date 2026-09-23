-- P1-01 · Core: branches, LINE secrets, profiles, user_branches, liquor_items, customers.
-- One organisation, many branches (CLAUDE.md §1): no org_id anywhere. RLS on every table,
-- grants written explicitly (Supabase default privileges hand anon/authenticated everything).

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

do $$ begin
  create type public.user_role as enum ('staff', 'bar', 'owner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.app_locale as enum ('th', 'en', 'zh', 'ko');
exception when duplicate_object then null; end $$;

-- ── shared trigger: updated_at from the database clock ───────────────────
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── branches ─────────────────────────────────────────────────────────────
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{2,5}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  sort integer not null default 0,
  deposit_days integer not null default 30 check (deposit_days between 1 and 3650),
  expiry_notice_days integer not null default 7 check (expiry_notice_days between 0 and 60),
  withdrawal_blocked_days text[] not null default array['Fri', 'Sat']
    check (withdrawal_blocked_days <@ array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
  opens_at time not null default '19:00',
  closes_at time not null default '02:00',
  phone text,
  liff_id text,
  line_channel_id text,
  line_bot_user_id text,
  staff_group_id text,
  receipt_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger branches_touch before update on public.branches
  for each row execute function private.touch_updated_at();

-- ── branch_line_secrets: service role only (DESIGN "LINE", RULINGS R-002) ─
create table if not exists public.branch_line_secrets (
  branch_id uuid primary key references public.branches (id) on delete cascade,
  channel_access_token text,
  channel_secret text,
  updated_at timestamptz not null default now()
);

create trigger branch_line_secrets_touch before update on public.branch_line_secrets
  for each row execute function private.touch_updated_at();

-- ── profiles ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name text not null default '' check (length(display_name) <= 80),
  role public.user_role not null default 'staff',
  locale public.app_locale not null default 'th' check (locale in ('th', 'en')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ── user_branches ────────────────────────────────────────────────────────
create table if not exists public.user_branches (
  user_id uuid not null references public.profiles (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);
create index if not exists user_branches_branch_idx on public.user_branches (branch_id);

-- ── liquor_items (a pick list, not stock) ────────────────────────────────
create table if not exists public.liquor_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches (id) on delete cascade,  -- null = every branch
  name text not null check (length(btrim(name)) between 1 and 120),
  category text not null default 'other'
    check (category in ('whisky', 'brandy', 'vodka', 'gin', 'rum', 'tequila', 'wine', 'other')),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists liquor_items_branch_idx on public.liquor_items (branch_id, active, sort);

create trigger liquor_items_touch before update on public.liquor_items
  for each row execute function private.touch_updated_at();

-- ── customers (LINE LIFF only — no auth.users row) ───────────────────────
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique check (line_user_id ~ '^U[0-9a-f]{32}$'),
  display_name text,
  picture_url text,
  phone text,
  locale public.app_locale not null default 'th',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customers_touch before update on public.customers
  for each row execute function private.touch_updated_at();

-- ── role helpers (SECURITY DEFINER: read profiles without recursing into its RLS) ─
create or replace function private.current_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function private.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'owner')
$$;

-- member of a branch: owner (every branch) or an active profile listed in user_branches
create or replace function private.is_member(p_branch uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'owner'
           or exists (select 1 from public.user_branches ub where ub.user_id = p.id and ub.branch_id = p_branch))
  )
$$;

-- member of the branch AND one of the given roles
create or replace function private.has_role_at(p_branch uuid, p_roles public.user_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = any (p_roles)
      and (p.role = 'owner'
           or exists (select 1 from public.user_branches ub where ub.user_id = p.id and ub.branch_id = p_branch))
  )
$$;

-- another profile shares at least one branch with the caller
create or replace function private.shares_branch(p_other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_branches mine
    join public.user_branches theirs on theirs.branch_id = mine.branch_id
    join public.profiles p on p.id = mine.user_id and p.active
    where mine.user_id = auth.uid() and theirs.user_id = p_other
  )
$$;

-- branches the caller may act in (owner: all active)
create or replace function private.my_branch_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select b.id from public.branches b
  where exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'owner')
  union
  select ub.branch_id from public.user_branches ub
  join public.profiles p on p.id = ub.user_id and p.active
  where ub.user_id = auth.uid()
$$;

revoke all on function private.current_role() from public, anon;
revoke all on function private.is_owner() from public, anon;
revoke all on function private.is_member(uuid) from public, anon;
revoke all on function private.has_role_at(uuid, public.user_role[]) from public, anon;
revoke all on function private.shares_branch(uuid) from public, anon;
revoke all on function private.my_branch_ids() from public, anon;
grant execute on function private.current_role() to authenticated, service_role;
grant execute on function private.is_owner() to authenticated, service_role;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.has_role_at(uuid, public.user_role[]) to authenticated, service_role;
grant execute on function private.shares_branch(uuid) to authenticated, service_role;
grant execute on function private.my_branch_ids() to authenticated, service_role;

-- ── new auth user → profile. Role is ALWAYS staff; only the owner (service role)
--    raises it afterwards. Username comes from app metadata (service-role only),
--    never from user metadata the client controls.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(coalesce(nullif(new.raw_app_meta_data ->> 'username', ''), split_part(new.email, '@', 1)));
begin
  v_username := regexp_replace(v_username, '[^a-z0-9._-]', '', 'g');
  if length(v_username) < 3 then v_username := 'user-' || substr(replace(new.id::text, '-', ''), 1, 8); end if;
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := left(v_username, 23) || '-' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, username, display_name, role)
  values (new.id, v_username, coalesce(new.raw_app_meta_data ->> 'display_name', v_username), 'staff')
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── profiles column guard: only the owner or the service role may change
--    role / active / username; nobody changes id.
create or replace function private.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  trusted boolean := coalesce(auth.role(), '') = 'service_role' or private.is_owner();
begin
  if new.id is distinct from old.id then
    raise exception 'PROFILE_ID_IMMUTABLE' using errcode = '42501';
  end if;
  if not trusted and (new.role is distinct from old.role
                      or new.active is distinct from old.active
                      or new.username is distinct from old.username) then
    raise exception 'OWNER_ONLY' using errcode = '42501';
  end if;
  -- the owner cannot lock themself out
  if old.id = auth.uid() and (new.role is distinct from old.role or new.active is distinct from old.active)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'CANNOT_CHANGE_OWN_ROLE' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function private.guard_profile_update();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.branches enable row level security;
alter table public.branch_line_secrets enable row level security;
alter table public.profiles enable row level security;
alter table public.user_branches enable row level security;
alter table public.liquor_items enable row level security;
alter table public.customers enable row level security;

revoke all on public.branches, public.branch_line_secrets, public.profiles, public.user_branches,
  public.liquor_items, public.customers from public, anon, authenticated;

grant select, insert, update, delete on public.branches to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.user_branches to authenticated;
grant select, insert, update, delete on public.liquor_items to authenticated;
grant select on public.customers to authenticated;
-- branch_line_secrets: no grant for authenticated at all (service role only)

-- branches
create policy branches_select on public.branches for select to authenticated
  using ((select private.is_member(id)));
create policy branches_insert on public.branches for insert to authenticated
  with check ((select private.is_owner()));
create policy branches_update on public.branches for update to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create policy branches_delete on public.branches for delete to authenticated
  using ((select private.is_owner()));

-- profiles: self, colleagues sharing a branch, owner sees all
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_owner()) or private.shares_branch(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_update_owner on public.profiles for update to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

-- user_branches
create policy user_branches_select on public.user_branches for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner()));
create policy user_branches_insert on public.user_branches for insert to authenticated
  with check ((select private.is_owner()));
create policy user_branches_delete on public.user_branches for delete to authenticated
  using ((select private.is_owner()));

-- liquor_items: global rows to every active member, branch rows to that branch
create policy liquor_items_select on public.liquor_items for select to authenticated
  using ((branch_id is null and (select private.current_role()) is not null)
         or (branch_id is not null and private.is_member(branch_id)));
create policy liquor_items_insert on public.liquor_items for insert to authenticated
  with check ((select private.is_owner()));
create policy liquor_items_update on public.liquor_items for update to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create policy liquor_items_delete on public.liquor_items for delete to authenticated
  using ((select private.is_owner()));

-- customers: the owner sees all here; P1-02/P1-03 add "customer of a deposit/booking in my branch"
create policy customers_select_owner on public.customers for select to authenticated
  using ((select private.is_owner()));
