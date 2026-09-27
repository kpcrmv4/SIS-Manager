-- R-066 · (owner request) more from realtime.
--   · print jobs: every new job and every change of its status goes to the branch topic as 'print_job'
--     (the old trigger on print_jobs went with the print-server port) — the printer icon, the jobs panel
--     and a "didn't print" toast follow it at once.
--   · the print station: its coming online or going quiet goes to the branch topic as 'printer' — a
--     heartbeat that changes nothing sends nothing; going quiet with no heartbeat at all is found by
--     the page's own clock (a heartbeat older than two minutes).
--   · presence: members may track themselves on their branch topic (who is looking at which page), so
--     two people don't walk the same bottle to the same table.
-- The staff app's page refresh ignores these two events (they change no list it shows).

create or replace function private.broadcast_print_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  perform realtime.send(
    jsonb_build_object('id', new.id, 'type', new.job_type, 'status', new.status, 'deposit_id', new.deposit_id,
      'code', new.payload ->> 'deposit_code', 'error', left(coalesce(new.error_message, ''), 200)),
    'print_job', 'branch:' || new.branch_id, true);
  return null;
end $$;
revoke all on function private.broadcast_print_job() from public, anon, authenticated;

drop trigger if exists print_jobs_broadcast on public.print_jobs;
create trigger print_jobs_broadcast after insert or update of status on public.print_jobs
  for each row execute function private.broadcast_print_job();

create or replace function private.broadcast_print_station()
returns trigger language plpgsql security definer set search_path = '' as $$
declare was_live boolean; is_live boolean;
begin
  was_live := tg_op = 'UPDATE' and old.is_online and old.last_heartbeat > now() - interval '2 minutes';
  is_live := new.is_online and new.last_heartbeat > now() - interval '2 minutes';
  if tg_op = 'UPDATE' and was_live = is_live then return null; end if;
  perform realtime.send(jsonb_build_object('online', is_live), 'printer', 'branch:' || new.branch_id, true);
  return null;
end $$;
revoke all on function private.broadcast_print_station() from public, anon, authenticated;

drop trigger if exists print_stations_broadcast on public.print_stations;
create trigger print_stations_broadcast after insert or update on public.print_stations
  for each row execute function private.broadcast_print_station();

-- presence on the branch topic: a member tracks themselves; everyone on the topic may read it (the
-- receive policy already lets members read their branch topics)
drop policy if exists sis_realtime_presence on realtime.messages;
create policy sis_realtime_presence on realtime.messages for insert to authenticated with check (
  realtime.messages.extension = 'presence'
  and private.topic_id(realtime.topic(), 'branch:') in (select private.my_branch_ids())
);
