-- R-051 · The E2E fixture branches never notify a real account (owner report 2026-09-24: test
-- deposits pushed to the owner's phone). An owner is told about every branch, and the fixture
-- branches (code Z??, named E2E…) live in the same project as the shop — so once the owner switched
-- push on, every test run's made-up deposits and bookings reached their phone and their bell.
-- A fixture branch now tells only the fixture accounts (usernames e2e…); every real branch is
-- unchanged. Same fixture rule as scripts/clean-e2e.mjs.

create or replace function private.is_fixture_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.branches b where b.id = p_branch and b.code ~ '^Z[A-Z]{2}$' and b.name like 'E2E%')
$$;

create or replace function private.notify_members(p_branch uuid, p_roles public.user_role[], p_kind text, p_payload jsonb, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, branch_id, kind, payload, link)
  select p.id, p_branch, p_kind, coalesce(p_payload, '{}'::jsonb), p_link
  from public.profiles p
  where p.active and p.role = any (p_roles)
    and (p.role = 'owner' or exists (select 1 from public.user_branches ub where ub.user_id = p.id and ub.branch_id = p_branch))
    and (not private.is_fixture_branch(p_branch) or p.username like 'e2e%')
$$;

revoke all on function private.is_fixture_branch(uuid) from public, anon, authenticated;
