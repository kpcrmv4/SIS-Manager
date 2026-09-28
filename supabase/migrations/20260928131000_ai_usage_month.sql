-- R-070: the owner's settings page shows what the assistant cost this month — one aggregate,
-- never a row dump (CLAUDE.md §6). Owner only; months are Bangkok months.
create or replace function public.ai_usage_month()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz := date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
begin
  if not private.is_owner() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'answers', count(*),
      'people', count(distinct user_id),
      'input_tokens', coalesce(sum(input_tokens), 0),
      'output_tokens', coalesce(sum(output_tokens), 0),
      'cache_read_tokens', coalesce(sum(cache_read_tokens), 0),
      'cache_write_tokens', coalesce(sum(cache_write_tokens), 0))
    from public.ai_usage where created_at >= since);
end $$;
revoke all on function public.ai_usage_month() from public, anon;
grant execute on function public.ai_usage_month() to authenticated;
