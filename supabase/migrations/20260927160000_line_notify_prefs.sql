-- R-063 · (owner request) the owner turns each automatic LINE message on or off, per branch. Every
-- message the system sends goes through private.enqueue_line, so the switch lives there: a kind listed
-- in branches.line_notify_off is never queued (it never reaches LINE and costs no quota). Replies to a
-- customer's own chat message (webhook reply tokens) are not automatic messages and are not switched.
-- The expiry reminders keep their own switch (expiry_reminders_enabled, R-044); the staff group's test
-- message is always sent.

alter table public.branches add column if not exists line_notify_off text[] not null default '{}';
comment on column public.branches.line_notify_off is 'R-063: automatic LINE message kinds this branch does not send.';
do $$ begin
  alter table public.branches add constraint branches_line_notify_off_kinds check (line_notify_off <@ array[
    'deposit_confirmed', 'deposit_rejected', 'withdraw_completed', 'withdraw_rejected', 'disposed',
    'booking_pending', 'booking_confirmed', 'booking_rejected', 'booking_cancelled', 'booking_reminder',
    'deposit_requested', 'withdrawal_requested', 'booking_new']::text[]);
exception when duplicate_object then null; end $$;

create or replace function private.enqueue_line(
  p_branch uuid, p_target_kind text, p_target text, p_kind text, p_locale public.app_locale, p_payload jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_target is null or btrim(p_target) = '' then return; end if;
  -- the owner switched this kind of message off for the branch (R-063)
  if exists (select 1 from public.branches b where b.id = p_branch and p_kind = any (b.line_notify_off)) then return; end if;
  insert into public.line_outbox (branch_id, target_kind, target, kind, locale, payload, dedupe_key)
  values (p_branch, p_target_kind, p_target, p_kind, coalesce(p_locale, 'th'), coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;
