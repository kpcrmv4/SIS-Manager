-- P3-B review: the receipt's secret LINE link code came from random(). Draw it from the
-- CSPRNG like the staff-group bind code (private.random_code, 20260924130000).
-- Existing codes stay valid; only new deposits get CSPRNG codes.
create or replace function private.new_link_code()
returns text language sql volatile set search_path = '' as $$
  select private.random_code(6)
$$;
revoke all on function private.new_link_code() from public, anon, authenticated;
