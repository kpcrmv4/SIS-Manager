-- (owner request) the deposit page's "แจ้งเตือนหมดอายุ" row had a "ส่ง" badge that read like a button
-- and did nothing. It becomes the history of what LINE told this customer about this deposit: every
-- customer message (confirmed, rejected, withdrawn, expiry reminders, expired, disposed) with whether
-- it went out, newest first. line_outbox stays service-role only; members read it through this RPC.

create index if not exists line_outbox_deposit_idx on public.line_outbox ((payload ->> 'deposit_id'), created_at desc)
  where target_kind = 'user';

create or replace function public.deposit_line_history(p_deposit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b uuid;
begin
  select branch_id into b from public.deposits where id = p_deposit;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(b, array['staff', 'bar', 'owner']::public.user_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'status', o.status, 'created_at', o.created_at,
      'sent_at', o.sent_at, 'attempts', o.attempts) order by o.created_at desc)
    from (
      select * from public.line_outbox
      where target_kind = 'user' and branch_id = b and payload ->> 'deposit_id' = p_deposit::text
      order by created_at desc limit 30
    ) o
  ), '[]'::jsonb);
end $$;

revoke all on function public.deposit_line_history(uuid) from public, anon;
grant execute on function public.deposit_line_history(uuid) to authenticated;
