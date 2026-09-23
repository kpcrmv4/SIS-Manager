-- Davis's heartbeat is a PostgREST upsert: ON CONFLICT DO UPDATE sets every column it sent,
-- branch_id included, so the print account needs UPDATE on branch_id too (the policy still
-- pins it to its own branch). And the new link-code generator must not be callable by anon.
grant update (branch_id) on public.print_stations to authenticated;
revoke all on function private.new_link_code() from public, anon, authenticated;
