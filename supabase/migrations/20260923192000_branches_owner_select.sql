-- P2 worker B found: an owner's `insert into branches … returning` failed 42501 — the
-- SELECT policy checks `id in (select private.my_branch_ids())`, and that scan of
-- branches cannot see the row the same statement is inserting. Owners see every branch,
-- so say that directly (cached once per statement) before the membership set.
drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated
  using ((select private.is_owner()) or id in (select private.my_branch_ids()));
