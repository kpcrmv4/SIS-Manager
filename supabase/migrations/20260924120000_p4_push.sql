-- P4-03: web push for in-app notifications. A notification row is claimed once
-- (pushed_at) and sent to every subscription of its user by /api/cron/push-dispatch
-- (pinged by pg_cron through pg_net, and inline by server code after it writes).

alter table public.notifications add column if not exists pushed_at timestamptz;
create index if not exists notifications_push_pending_idx on public.notifications (created_at) where pushed_at is null;

-- claim up to p_limit unpushed notifications from the last hour and return one row per
-- (notification × subscription). Notifications of users without a subscription are
-- claimed too — there is nothing to send for them, ever.
create or replace function public.claim_push(p_limit integer default 50)
returns table (notification_id uuid, user_id uuid, kind text, payload jsonb, link text,
               subscription_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
  with claimed as (
    update public.notifications n set pushed_at = now()
    where n.id in (
      select id from public.notifications
      where pushed_at is null and created_at > now() - interval '1 hour'
      order by created_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked)
    returning n.id, n.user_id, n.kind, n.payload, n.link
  )
  select c.id, c.user_id, c.kind, c.payload, c.link, s.id, s.endpoint, s.p256dh, s.auth
  from claimed c join public.push_subscriptions s on s.user_id = c.user_id;
end $$;

create or replace function private.ping_push_dispatch()
returns void language plpgsql security definer set search_path = '' as $$
declare base text; secret text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(base, '') = '' or coalesce(secret, '') = '' then return; end if;
  if not exists (
    select 1 from public.notifications n
    where n.pushed_at is null and n.created_at > now() - interval '1 hour'
      and exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)
  ) then
    return;
  end if;
  perform net.http_post(
    url := rtrim(base, '/') || '/api/cron/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000);
end $$;

revoke all on function public.claim_push(integer) from public, anon, authenticated;
grant execute on function public.claim_push(integer) to service_role;
revoke all on function private.ping_push_dispatch() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('sis-push-dispatch') where exists (select 1 from cron.job where jobname = 'sis-push-dispatch');
end $$;
select cron.schedule('sis-push-dispatch', '* * * * *', 'select private.ping_push_dispatch()');
