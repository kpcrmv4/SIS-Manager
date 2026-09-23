-- P1-04 · Outbox dispatch, in-app notifications, push subscriptions, print jobs/stations,
-- private photo bucket, realtime broadcast (per-branch topics) and pg_cron jobs.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$ begin
  create type public.print_status as enum ('pending', 'printing', 'done', 'failed');
exception when duplicate_object then null; end $$;

-- ── outbox dispatch (called by /api/cron/line-dispatch with the service role) ─
-- claim due rows: queued, or failed with a retry due, or stuck in 'sending' for 5 minutes
create or replace function public.claim_outbox(p_limit integer default 20)
returns setof public.line_outbox language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
  update public.line_outbox o set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'
  where o.id in (
    select id from public.line_outbox
    where (status in ('queued', 'failed') and next_attempt_at <= now() and attempts < 6)
       or (status = 'sending' and next_attempt_at <= now() and attempts < 6)
    order by created_at
    limit greatest(1, least(p_limit, 100))
    for update skip locked)
  returning o.*;
end $$;

-- sent / failed (exponential backoff 1, 2, 4, 8, 16 min) / skipped (no token, blocked user…)
create or replace function public.finish_outbox(p_id uuid, p_status public.outbox_status, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('sent', 'failed', 'skipped') then raise exception 'BAD_STATUS' using errcode = '22023'; end if;
  update public.line_outbox set status = p_status,
    sent_at = case when p_status = 'sent' then now() end,
    error = left(p_error, 500),
    next_attempt_at = case when p_status = 'failed' then now() + make_interval(mins => power(2, greatest(attempts - 1, 0))::int) else next_attempt_at end
  where id = p_id and status = 'sending';
end $$;

revoke all on function public.claim_outbox(integer) from public, anon, authenticated;
revoke all on function public.finish_outbox(uuid, public.outbox_status, text) from public, anon, authenticated;
grant execute on function public.claim_outbox(integer) to service_role;
grant execute on function public.finish_outbox(uuid, public.outbox_status, text) to service_role;

-- ── in-app notifications (the bell) ──────────────────────────────────────
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- one row per active member of the branch holding one of the roles (owners always)
create or replace function private.notify_members(p_branch uuid, p_roles public.user_role[], p_kind text, p_payload jsonb, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, branch_id, kind, payload, link)
  select p.id, p_branch, p_kind, coalesce(p_payload, '{}'::jsonb), p_link
  from public.profiles p
  where p.active and p.role = any (p_roles)
    and (p.role = 'owner' or exists (select 1 from public.user_branches ub where ub.user_id = p.id and ub.branch_id = p_branch))
$$;

-- work that needs someone: bottles to confirm → bar; withdrawal / LINE deposit request → floor
create or replace function private.notify_on_deposit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype;
begin
  if new.action not in ('received', 'withdrawal_requested', 'requested') then return new; end if;
  select * into d from public.deposits where id = new.deposit_id;
  perform private.notify_members(d.branch_id,
    case when new.action = 'received' then array['bar', 'owner']::public.user_role[] else array['staff', 'bar', 'owner']::public.user_role[] end,
    'deposit_' || new.action,
    jsonb_build_object('deposit_id', d.id, 'code', d.code, 'item', d.item_name, 'customer', d.customer_name, 'table', d.table_label),
    '/deposits/' || d.id);
  return new;
end $$;
create trigger deposit_events_notify after insert on public.deposit_events
  for each row execute function private.notify_on_deposit_event();

create or replace function private.notify_on_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    perform private.notify_members(new.branch_id, array['bar', 'owner']::public.user_role[], 'booking_pending',
      jsonb_build_object('booking_id', new.id, 'code', new.code, 'name', new.name, 'party', new.party_size,
        'night', new.night, 'time', to_char(new.slot_time, 'HH24:MI')),
      '/bookings?night=' || new.night);
  end if;
  return new;
end $$;
create trigger bookings_notify after insert on public.bookings
  for each row execute function private.notify_on_booking();

-- ── web push subscriptions ───────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ── print stations + jobs (print-server signs in as a print account whose
--    app_metadata.print_branch names the one branch it serves) ─────────────
create or replace function private.print_branch()
returns uuid language sql stable set search_path = '' as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'print_branch', '')::uuid
$$;

create table if not exists public.print_stations (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null unique references public.branches (id) on delete cascade,
  account_id uuid references auth.users (id) on delete set null,
  name text not null default 'Print station',
  printer_name text,
  last_seen_at timestamptz,
  version text,
  created_at timestamptz not null default now()
);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  deposit_id uuid references public.deposits (id) on delete set null,
  type text not null check (type in ('receipt', 'label')),
  copies integer not null default 1 check (copies between 1 and 5),
  payload jsonb not null default '{}'::jsonb,
  status public.print_status not null default 'pending',
  attempts integer not null default 0,
  error text,
  requested_by uuid references public.profiles (id) default auth.uid(),
  printed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists print_jobs_branch_status_idx on public.print_jobs (branch_id, status, created_at);

-- ── RLS + grants ─────────────────────────────────────────────────────────
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.print_stations enable row level security;
alter table public.print_jobs enable row level security;
revoke all on public.notifications, public.push_subscriptions, public.print_stations, public.print_jobs from public, anon, authenticated;

grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, delete on public.push_subscriptions to authenticated;
create policy push_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_insert on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()) and (select private.current_role()) is not null);
create policy push_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.print_stations to authenticated;
grant update (printer_name, last_seen_at, version) on public.print_stations to authenticated;
create policy print_stations_select on public.print_stations for select to authenticated
  using (branch_id in (select private.my_branch_ids()) or branch_id = (select private.print_branch()));
create policy print_stations_heartbeat on public.print_stations for update to authenticated
  using (branch_id = (select private.print_branch())) with check (branch_id = (select private.print_branch()));

grant select, insert on public.print_jobs to authenticated;
grant update (status, attempts, error, printed_at) on public.print_jobs to authenticated;
create policy print_jobs_select on public.print_jobs for select to authenticated
  using (branch_id in (select private.my_branch_ids()) or branch_id = (select private.print_branch()));
create policy print_jobs_insert on public.print_jobs for insert to authenticated
  with check (branch_id in (select private.my_branch_ids()) and requested_by = (select auth.uid()));
create policy print_jobs_update on public.print_jobs for update to authenticated
  using (branch_id = (select private.print_branch())) with check (branch_id = (select private.print_branch()));

revoke all on function private.notify_members(uuid, public.user_role[], text, jsonb, text) from public, anon, authenticated;
revoke all on function private.notify_on_deposit_event() from public, anon, authenticated;
revoke all on function private.notify_on_booking() from public, anon, authenticated;
revoke all on function private.print_branch() from public, anon;
grant execute on function private.print_branch() to authenticated, service_role;

-- ── storage: private deposit photos, path = <branch_id>/<yyyy-mm>/<uuid>.<ext> ─
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deposit-photos', 'deposit-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.storage_branch(p_name text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then return null;
end $$;
revoke all on function private.storage_branch(text) from public, anon;
grant execute on function private.storage_branch(text) to authenticated, service_role;

drop policy if exists deposit_photos_select on storage.objects;
drop policy if exists deposit_photos_insert on storage.objects;
create policy deposit_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'deposit-photos' and private.storage_branch(name) in (select private.my_branch_ids()));
create policy deposit_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'deposit-photos' and private.storage_branch(name) in (select private.my_branch_ids()));

-- ── realtime: broadcast from the database to private per-branch / per-user topics ─
create or replace function private.broadcast_branch_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rec record; topic text;
begin
  rec := case when tg_op = 'DELETE' then old else new end;
  topic := 'branch:' || rec.branch_id;
  perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op, 'id', rec.id), tg_table_name, topic, true);
  return null;
end $$;

create or replace function private.broadcast_user_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('id', new.id, 'kind', new.kind), 'notification', 'user:' || new.user_id, true);
  return null;
end $$;

create or replace function private.broadcast_print_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('id', new.id, 'type', new.type), 'print_job', 'print:' || new.branch_id, true);
  return null;
end $$;

create trigger deposits_broadcast after insert or update on public.deposits for each row execute function private.broadcast_branch_change();
create trigger withdrawals_broadcast after insert or update on public.withdrawals for each row execute function private.broadcast_branch_change();
create trigger bookings_broadcast after insert or update on public.bookings for each row execute function private.broadcast_branch_change();
create trigger notifications_broadcast after insert on public.notifications for each row execute function private.broadcast_user_notification();
create trigger print_jobs_broadcast after insert on public.print_jobs for each row execute function private.broadcast_print_job();

revoke all on function private.broadcast_branch_change() from public, anon, authenticated;
revoke all on function private.broadcast_user_notification() from public, anon, authenticated;
revoke all on function private.broadcast_print_job() from public, anon, authenticated;

-- who may listen: branch topics for members, own user topic, print topic for that branch's print account
drop policy if exists sis_realtime_receive on realtime.messages;
create policy sis_realtime_receive on realtime.messages for select to authenticated using (
  (realtime.topic() like 'branch:%' and substr(realtime.topic(), 8)::uuid in (select private.my_branch_ids()))
  or realtime.topic() = 'user:' || (select auth.uid())::text
  or (realtime.topic() like 'print:%' and substr(realtime.topic(), 7)::uuid = (select private.print_branch()))
);

-- ── booking reminder (LINE, the afternoon of the booking) ─────────────────
create or replace function public.send_booking_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare b record; n int := 0;
begin
  if not (private.is_service() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  for b in
    update public.bookings set reminder_sent_at = now()
    where status = 'confirmed' and reminder_sent_at is null and customer_id is not null
      and night = private.business_night(now())
    returning id
  loop
    n := n + 1;
    perform private.notify_booking(b.id, 'booking_reminder', '{}'::jsonb, 'booking_reminder:' || b.id);
  end loop;
  return n;
end $$;
revoke all on function public.send_booking_reminders() from public, anon, authenticated;
grant execute on function public.send_booking_reminders() to service_role;

-- ── pg_cron → the app's dispatch endpoint. Base URL + secret live in Vault
--    (scripts/sync-vault.mjs); with no base URL the job is a no-op. ────────
create or replace function private.ping_line_dispatch()
returns void language plpgsql security definer set search_path = '' as $$
declare base text; secret text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  if coalesce(base, '') = '' or coalesce(secret, '') = '' then return; end if;
  if not exists (select 1 from public.line_outbox where status in ('queued', 'failed', 'sending') and next_attempt_at <= now() and attempts < 6) then
    return;
  end if;
  perform net.http_post(
    url := rtrim(base, '/') || '/api/cron/line-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000);
end $$;
revoke all on function private.ping_line_dispatch() from public, anon, authenticated;

do $$
declare j text;
begin
  foreach j in array array['sis-expiry-notices', 'sis-expire-deposits', 'sis-no-shows', 'sis-line-dispatch', 'sis-booking-reminders'] loop
    perform cron.unschedule(j) where exists (select 1 from cron.job where jobname = j);
  end loop;
end $$;
-- all schedules are UTC: 05:00 UTC = 12:00 Bangkok, 09:00 UTC = 16:00 Bangkok
select cron.schedule('sis-expiry-notices', '0 5 * * *', 'select public.send_expiry_notices()');
select cron.schedule('sis-expire-deposits', '7 * * * *', 'select public.expire_due_deposits()');
select cron.schedule('sis-no-shows', '*/5 * * * *', 'select public.mark_no_shows()');
select cron.schedule('sis-line-dispatch', '* * * * *', 'select private.ping_line_dispatch()');
select cron.schedule('sis-booking-reminders', '0 9 * * *', 'select public.send_booking_reminders()');
