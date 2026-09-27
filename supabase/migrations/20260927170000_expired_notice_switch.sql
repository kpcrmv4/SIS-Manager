-- R-064 · (owner request) the "expired" LINE message has its own switch. Some shops want the reminders
-- before a deposit expires but no message once it has: expiry_reminders_enabled now covers the
-- reminders alone (with their days and wording); expired_notice_enabled covers the message sent when
-- the collection deadline has passed. Both run at the branch's expiry_reminder_time. Existing
-- branches keep what they had: the new switch starts as the old one was.

alter table public.branches add column if not exists expired_notice_enabled boolean not null default true;
comment on column public.branches.expired_notice_enabled is 'R-064: send the "expired" LINE message once a deposit passes its collection deadline.';
update public.branches set expired_notice_enabled = expiry_reminders_enabled where expired_notice_enabled <> expiry_reminders_enabled;

create or replace function public.run_expiry_notices(p_branch uuid default null, p_force boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Bangkok')::date;
  now_t time := (now() at time zone 'Asia/Bangkok')::time;
  b record;
  d record;
  claimed integer;
  due integer[];
  left_days integer;
  tpl text;
  send boolean;
  n integer := 0;
begin
  if not (private.is_service() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  for b in
    select br.id, br.expiry_reminders_enabled, br.expired_notice_enabled, br.expiry_reminder_days, br.expiry_reminder_templates
    from public.branches br
    where br.active and (p_branch is null or br.id = p_branch)
      and (p_force or now_t >= br.expiry_reminder_time)
  loop
    -- once a day: the first run at or after the branch's time claims the day
    if not p_force then
      claimed := null;
      insert into private.expiry_notice_runs as r (branch_id, ran_on) values (b.id, today)
      on conflict (branch_id) do update set ran_on = excluded.ran_on where r.ran_on < excluded.ran_on
      returning 1 into claimed;
      continue when claimed is null;
    end if;

    -- reminders: one message per deposit, however many of its reminder days are due
    for d in
      select dep.id, dep.expires_at, dep.expiry_reminders_sent, c.locale::text as locale, c.expiry_notices_enabled
      from public.deposits dep
      join public.customers c on c.id = dep.customer_id
      where dep.branch_id = b.id and dep.status in ('in_store', 'pending_withdrawal')
        and not dep.is_vip and dep.expires_at is not null
    loop
      left_days := (d.expires_at at time zone 'Asia/Bangkok')::date - today;
      continue when left_days < 1;
      select coalesce(array_agg(s.x order by s.x desc), '{}') into due
      from (select distinct x from unnest(b.expiry_reminder_days) as u (x)) s
      where left_days <= s.x and not (s.x = any (d.expiry_reminders_sent));
      continue when cardinality(due) = 0;
      send := b.expiry_reminders_enabled and d.expiry_notices_enabled;
      update public.deposits
      set expiry_reminders_sent = expiry_reminders_sent || due,
          expiry_notice_sent_at = case when send then now() else expiry_notice_sent_at end
      where id = d.id;
      if send then
        tpl := nullif(btrim(b.expiry_reminder_templates ->> coalesce(d.locale, 'th')), '');
        perform private.notify_customer(d.id, 'expiry_soon',
          jsonb_build_object('days', left_days)
            || case when tpl is null then '{}'::jsonb else jsonb_build_object('template', tpl) end,
          'expiry_soon:' || d.id || ':' || to_char(d.expires_at at time zone 'Asia/Bangkok', 'YYYYMMDD') || ':' || due[cardinality(due)]);
        n := n + 1;
      end if;
    end loop;

    -- expired since the last runs (two days back at most — nothing stale after a switch-off)
    for d in
      select dep.id, c.expiry_notices_enabled
      from public.deposits dep
      join public.customers c on c.id = dep.customer_id
      where dep.branch_id = b.id and dep.status = 'expired' and dep.expired_notice_sent_at is null
        and dep.collect_deadline_at > now() - interval '2 days'
    loop
      if b.expired_notice_enabled and d.expiry_notices_enabled then
        update public.deposits set expired_notice_sent_at = now() where id = d.id;
        perform private.notify_customer(d.id, 'expired', '{}'::jsonb, 'expired:' || d.id);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.run_expiry_notices(uuid, boolean) from public, anon, authenticated;
grant execute on function public.run_expiry_notices(uuid, boolean) to service_role;
