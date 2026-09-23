-- P1-02 · Deposits: deposits, bottles, withdrawals, events, LINE outbox table,
-- ported Davis rules (collection deadline, withdrawal deadline guard, whole-bottle
-- withdrawals, expiry/VIP bar-only) and every deposit state change as an RPC.
-- Direct INSERT/UPDATE/DELETE is not granted to authenticated on any of these tables.

do $$ begin
  create type public.deposit_status as enum
    ('requested', 'pending_confirm', 'in_store', 'pending_withdrawal', 'withdrawn', 'expired', 'disposed', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.bottle_status as enum ('sealed', 'opened', 'consumed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.withdrawal_status as enum ('pending', 'completed', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.withdrawal_type as enum ('in_store', 'take_home');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.outbox_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

-- ── time helpers ─────────────────────────────────────────────────────────
-- Business night: before 06:00 Bangkok belongs to the previous night (RULINGS R-006).
create or replace function private.business_night(p_at timestamptz default now())
returns date language sql stable set search_path = '' as $$
  select ((p_at at time zone 'Asia/Bangkok') - interval '6 hours')::date
$$;

create or replace function private.dow_name(p_day date)
returns text language sql immutable set search_path = '' as $$
  select (array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])[extract(isodow from p_day)::int]
$$;

-- Ported from Davis private.deposit_collection_deadline: the last eligible night is the
-- expiry's Bangkok date, moved forward past blocked days; collection ends 04:00 the day after.
create or replace function private.deposit_collection_deadline(p_expiry timestamptz, p_blocked text[])
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare
  last_night date := (p_expiry at time zone 'Asia/Bangkok')::date;
  added integer := 0;
begin
  if p_expiry is null then return null; end if;
  while private.dow_name(last_night) = any (coalesce(p_blocked, array['Fri', 'Sat'])) and added < 7 loop
    last_night := last_night + 1;
    added := added + 1;
  end loop;
  return (last_night + 1 + time '04:00') at time zone 'Asia/Bangkok';
end $$;

-- ── deposits ─────────────────────────────────────────────────────────────
create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  code text not null unique check (code ~ '^DEP-[A-Z]{2,5}-[A-Z0-9]{5}$'),
  source text not null default 'staff' check (source in ('staff', 'line')),
  customer_id uuid references public.customers (id) on delete set null,
  customer_name text not null check (length(btrim(customer_name)) between 1 and 120),
  customer_phone text check (customer_phone is null or customer_phone ~ '^[0-9+\- ]{6,20}$'),
  table_label text check (table_label is null or length(table_label) <= 20),
  item_id uuid references public.liquor_items (id) on delete set null,
  item_name text not null check (length(btrim(item_name)) between 1 and 120),
  category text not null default 'other',
  quantity integer not null check (quantity between 0 and 50),
  remaining_qty integer not null default 0 check (remaining_qty >= 0 and remaining_qty <= quantity),
  remaining_percent numeric(5, 2) not null default 100 check (remaining_percent between 0 and 100),
  status public.deposit_status not null,
  is_vip boolean not null default false,
  expires_at timestamptz,
  collect_deadline_at timestamptz,
  photo_paths text[] not null default '{}',
  confirm_photo_paths text[] not null default '{}',
  notes text check (notes is null or length(notes) <= 500),
  received_by uuid references public.profiles (id),
  received_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  disposed_by uuid references public.profiles (id),
  disposed_at timestamptz,
  dispose_reason text,
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text,
  terms_accepted_at timestamptz,
  terms_version text,
  terms_locale public.app_locale,
  expiry_notice_sent_at timestamptz,
  expired_notice_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposits_terms_complete check (
    (terms_accepted_at is null and terms_version is null and terms_locale is null)
    or (terms_accepted_at is not null and terms_version is not null and terms_locale is not null)
  ),
  constraint deposits_vip_no_expiry check (not is_vip or expires_at is null)
);

create index if not exists deposits_branch_status_idx on public.deposits (branch_id, status, created_at desc);
create index if not exists deposits_branch_deadline_idx on public.deposits (branch_id, collect_deadline_at) where status in ('in_store', 'pending_withdrawal');
create index if not exists deposits_customer_idx on public.deposits (customer_id) where customer_id is not null;
create index if not exists deposits_phone_idx on public.deposits (branch_id, customer_phone) where customer_phone is not null;
create index if not exists deposits_item_idx on public.deposits (item_id) where item_id is not null;

create trigger deposits_touch before update on public.deposits
  for each row execute function private.touch_updated_at();

-- collection deadline snapshot (Davis): recomputed only when expiry / VIP / branch change
create or replace function private.set_deposit_collection_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare blocked text[];
begin
  if tg_op = 'UPDATE' then
    if old.terms_accepted_at is not null and
       (new.terms_accepted_at, new.terms_version, new.terms_locale) is distinct from
       (old.terms_accepted_at, old.terms_version, old.terms_locale) then
      raise exception 'TERMS_IMMUTABLE' using errcode = '23514';
    end if;
    if (new.expires_at, new.branch_id, new.is_vip) is not distinct from (old.expires_at, old.branch_id, old.is_vip) then
      new.collect_deadline_at := old.collect_deadline_at;
      return new;
    end if;
  end if;
  select b.withdrawal_blocked_days into blocked from public.branches b where b.id = new.branch_id;
  new.collect_deadline_at := case when new.is_vip or new.expires_at is null then null
    else private.deposit_collection_deadline(new.expires_at, blocked) end;
  return new;
end $$;

create trigger deposits_deadline before insert or update on public.deposits
  for each row execute function private.set_deposit_collection_deadline();

-- expiry / VIP: bar and owner only (Davis enforce_deposit_expiry_vip_bar_only, re-scoped)
create or replace function private.guard_deposit_expiry_vip()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- intake of a LINE request sets the first expiry (Davis pending_staff exemption)
  if old.status = 'requested' and new.is_vip is not distinct from old.is_vip then return new; end if;
  if (new.expires_at is distinct from old.expires_at or new.is_vip is distinct from old.is_vip)
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin')
     and coalesce(private.current_role()::text, '') not in ('bar', 'owner') then
    raise exception 'BAR_ONLY' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger deposits_expiry_vip_guard before update of expires_at, is_vip on public.deposits
  for each row execute function private.guard_deposit_expiry_vip();

-- ── bottles ──────────────────────────────────────────────────────────────
create table if not exists public.deposit_bottles (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.deposits (id) on delete cascade,
  bottle_no integer not null check (bottle_no between 1 and 50),
  remaining_percent numeric(5, 2) not null default 100 check (remaining_percent between 0 and 100),
  status public.bottle_status not null default 'sealed',
  consumed_at timestamptz,
  consumed_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (deposit_id, bottle_no)
);

create trigger deposit_bottles_touch before update on public.deposit_bottles
  for each row execute function private.touch_updated_at();

-- Davis auto_create_deposit_bottles: one sealed 100% row per bottle, except LINE requests
-- (bottles are created when staff receive the request)
create or replace function private.auto_create_deposit_bottles()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.deposit_bottles (deposit_id, bottle_no)
  select new.id, gs.n from generate_series(1, new.quantity) as gs (n)
  on conflict (deposit_id, bottle_no) do nothing;
  return new;
end $$;

create trigger deposits_auto_bottles after insert on public.deposits
  for each row when (new.quantity > 0 and new.status <> 'requested')
  execute function private.auto_create_deposit_bottles();

-- ── withdrawals ──────────────────────────────────────────────────────────
create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.deposits (id) on delete cascade,
  branch_id uuid not null references public.branches (id),
  bottle_id uuid references public.deposit_bottles (id) on delete set null,
  qty integer not null default 1 check (qty = 1),
  type public.withdrawal_type not null default 'in_store',
  status public.withdrawal_status not null default 'pending',
  by_customer boolean not null default false,
  customer_id uuid references public.customers (id) on delete set null,
  requested_by uuid references public.profiles (id),
  processed_by uuid references public.profiles (id),
  processed_at timestamptz,
  table_label text check (table_label is null or length(table_label) <= 20),
  photo_path text,
  notes text check (notes is null or length(notes) <= 500),
  reject_reason text,
  created_at timestamptz not null default now()
);
create index if not exists withdrawals_deposit_idx on public.withdrawals (deposit_id, status);
create index if not exists withdrawals_branch_status_idx on public.withdrawals (branch_id, status, created_at desc);
create unique index if not exists withdrawals_one_pending_per_bottle on public.withdrawals (bottle_id) where status = 'pending';

-- Davis guard: no new/completed withdrawal once the deposit is expired or past its deadline.
-- Rejections and cancellations stay possible after expiry.
create or replace function private.guard_withdrawal_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dep public.deposits%rowtype;
begin
  if new.status not in ('pending', 'completed') then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select * into dep from public.deposits where id = new.deposit_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = '23514'; end if;
  if dep.status in ('expired', 'disposed', 'cancelled', 'withdrawn')
     or (dep.collect_deadline_at is not null and clock_timestamp() >= dep.collect_deadline_at) then
    raise exception 'DEPOSIT_EXPIRED' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger withdrawals_deadline before insert or update on public.withdrawals
  for each row execute function private.guard_withdrawal_deadline();

-- ── events (append-only history) ─────────────────────────────────────────
create table if not exists public.deposit_events (
  id bigint generated always as identity primary key,
  deposit_id uuid not null references public.deposits (id) on delete cascade,
  branch_id uuid not null references public.branches (id),
  actor_id uuid references public.profiles (id),
  actor_kind text not null default 'staff' check (actor_kind in ('staff', 'customer', 'system')),
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists deposit_events_deposit_idx on public.deposit_events (deposit_id, created_at);
create index if not exists deposit_events_branch_idx on public.deposit_events (branch_id, created_at desc);

-- ── LINE outbox (dispatch + cron in P1-04) ───────────────────────────────
create table if not exists public.line_outbox (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  target_kind text not null check (target_kind in ('user', 'group')),
  target text not null,
  kind text not null,
  locale public.app_locale not null default 'th',
  payload jsonb not null default '{}'::jsonb,
  status public.outbox_status not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists line_outbox_due_idx on public.line_outbox (next_attempt_at) where status in ('queued', 'failed');

-- ── internal helpers used by the RPCs ────────────────────────────────────
-- raises unless the caller is an active member of the branch with one of the roles
create or replace function private.require_role(p_branch uuid, p_roles public.user_role[])
returns public.user_role language plpgsql stable security definer set search_path = '' as $$
declare r public.user_role;
begin
  r := private.current_role();
  if r is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not private.is_member(p_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not (r = any (p_roles)) then
    raise exception '%', case when p_roles = array['bar', 'owner']::public.user_role[] then 'BAR_ONLY' else 'FORBIDDEN' end
      using errcode = '42501';
  end if;
  return r;
end $$;

create or replace function private.is_service()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.role(), '') = 'service_role'
$$;

create or replace function private.log_event(p_deposit uuid, p_branch uuid, p_action text, p_payload jsonb, p_kind text default 'staff')
returns void language sql security definer set search_path = '' as $$
  insert into public.deposit_events (deposit_id, branch_id, actor_id, actor_kind, action, payload)
  values (p_deposit, p_branch, auth.uid(), p_kind, p_action, coalesce(p_payload, '{}'::jsonb))
$$;

-- enqueue one LINE message; the dedupe key makes a retried transaction a no-op
create or replace function private.enqueue_line(
  p_branch uuid, p_target_kind text, p_target text, p_kind text, p_locale public.app_locale, p_payload jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_target is null or btrim(p_target) = '' then return; end if;
  insert into public.line_outbox (branch_id, target_kind, target, kind, locale, payload, dedupe_key)
  values (p_branch, p_target_kind, p_target, p_kind, coalesce(p_locale, 'th'), coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

-- message to the deposit's customer (if LINE-linked)
create or replace function private.notify_customer(p_deposit uuid, p_kind text, p_extra jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; c public.customers%rowtype;
begin
  select * into d from public.deposits where id = p_deposit;
  if d.customer_id is null then return; end if;
  select * into c from public.customers where id = d.customer_id;
  perform private.enqueue_line(d.branch_id, 'user', c.line_user_id, p_kind, c.locale,
    jsonb_build_object('deposit_id', d.id, 'code', d.code, 'item', d.item_name, 'quantity', d.quantity,
      'remaining', d.remaining_qty, 'expires_at', d.expires_at, 'deadline', d.collect_deadline_at) || coalesce(p_extra, '{}'::jsonb),
    p_dedupe);
end $$;

-- message to the branch staff group (if configured)
create or replace function private.notify_staff_group(p_branch uuid, p_kind text, p_payload jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare g text;
begin
  select staff_group_id into g from public.branches where id = p_branch;
  perform private.enqueue_line(p_branch, 'group', g, p_kind, 'th', p_payload, p_dedupe);
end $$;

-- recompute remaining_qty / remaining_percent / status after bottle or withdrawal changes
create or replace function private.refresh_deposit(p_deposit uuid)
returns public.deposit_status language plpgsql security definer set search_path = '' as $$
declare left_qty integer; level numeric; pending boolean; st public.deposit_status;
begin
  select count(*) filter (where status <> 'consumed'),
         avg(remaining_percent) filter (where status <> 'consumed')
    into left_qty, level from public.deposit_bottles where deposit_id = p_deposit;
  select exists (select 1 from public.withdrawals where deposit_id = p_deposit and status = 'pending') into pending;
  st := case when left_qty = 0 then 'withdrawn' when pending then 'pending_withdrawal' else 'in_store' end;
  update public.deposits set remaining_qty = left_qty, remaining_percent = coalesce(round(level, 2), 0), status = st
  where id = p_deposit;
  return st;
end $$;

create or replace function private.new_deposit_code(p_branch uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare bc text; alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; s text := ''; i int;
begin
  select code into bc from public.branches where id = p_branch;
  for i in 1..5 loop
    s := s || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'DEP-' || bc || '-' || s;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- RPCs (SECURITY DEFINER, role + branch checked inside, one transaction each)
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.create_deposit(
  p_branch uuid,
  p_customer_name text,
  p_item_name text,
  p_quantity integer,
  p_photo_paths text[],
  p_customer_phone text default null,
  p_table text default null,
  p_item_id uuid default null,
  p_category text default null,
  p_notes text default null,
  p_expires_at timestamptz default null,
  p_customer_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.user_role;
  days integer;
  cat text;
  new_id uuid;
  new_code text;
  tries int := 0;
begin
  r := private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
  if p_quantity is null or p_quantity < 1 or p_quantity > 50 then raise exception 'BAD_QUANTITY' using errcode = '22023'; end if;
  if r = 'staff' and coalesce(array_length(p_photo_paths, 1), 0) = 0 then
    raise exception 'PHOTO_REQUIRED' using errcode = '22023';
  end if;
  if p_expires_at is not null and r = 'staff' then raise exception 'BAR_ONLY' using errcode = '42501'; end if;
  select deposit_days into days from public.branches where id = p_branch and active;
  if days is null then raise exception 'BRANCH_INACTIVE' using errcode = '22023'; end if;
  cat := coalesce(p_category, (select category from public.liquor_items where id = p_item_id), 'other');

  loop
    tries := tries + 1;
    new_code := private.new_deposit_code(p_branch);
    begin
      insert into public.deposits (branch_id, code, customer_id, customer_name, customer_phone, table_label,
        item_id, item_name, category, quantity, remaining_qty, status, expires_at, photo_paths, notes,
        received_by, received_at)
      values (p_branch, new_code, p_customer_id, btrim(p_customer_name), nullif(btrim(p_customer_phone), ''),
        nullif(btrim(p_table), ''), p_item_id, btrim(p_item_name), cat, p_quantity, p_quantity, 'pending_confirm',
        coalesce(p_expires_at, now() + make_interval(days => days)), coalesce(p_photo_paths, '{}'), nullif(btrim(p_notes), ''),
        auth.uid(), now())
      returning id into new_id;
      exit;
    exception when unique_violation then
      if tries >= 8 then raise exception 'CODE_EXHAUSTED'; end if;
    end;
  end loop;

  perform private.log_event(new_id, p_branch, 'received', jsonb_build_object('count', p_quantity));
  return jsonb_build_object('id', new_id, 'code', new_code);
end $$;

-- a LINE request (status requested) becomes a received deposit
create or replace function public.staff_receive_request(
  p_deposit uuid, p_quantity integer, p_photo_paths text[],
  p_item_name text default null, p_item_id uuid default null, p_table text default null, p_customer_phone text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; r public.user_role; days integer;
begin
  select * into d from public.deposits where id = p_deposit for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  r := private.require_role(d.branch_id, array['staff', 'bar', 'owner']::public.user_role[]);
  if d.status <> 'requested' then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 50 then raise exception 'BAD_QUANTITY' using errcode = '22023'; end if;
  if r = 'staff' and coalesce(array_length(p_photo_paths, 1), 0) = 0 then raise exception 'PHOTO_REQUIRED' using errcode = '22023'; end if;
  select deposit_days into days from public.branches where id = d.branch_id;

  update public.deposits set
    quantity = p_quantity, remaining_qty = p_quantity, remaining_percent = 100, status = 'pending_confirm',
    item_name = coalesce(nullif(btrim(p_item_name), ''), item_name), item_id = coalesce(p_item_id, item_id),
    table_label = coalesce(nullif(btrim(p_table), ''), table_label),
    customer_phone = coalesce(nullif(btrim(p_customer_phone), ''), customer_phone),
    photo_paths = coalesce(p_photo_paths, '{}'), received_by = auth.uid(), received_at = now(),
    expires_at = now() + make_interval(days => days)
  where id = d.id;
  insert into public.deposit_bottles (deposit_id, bottle_no)
  select d.id, gs.n from generate_series(1, p_quantity) as gs (n) on conflict do nothing;

  perform private.log_event(d.id, d.branch_id, 'received', jsonb_build_object('count', p_quantity, 'from_request', true));
  return jsonb_build_object('id', d.id, 'code', d.code);
end $$;

create or replace function public.confirm_deposit(p_deposit uuid, p_levels numeric[], p_photo_paths text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; st public.deposit_status; i int; lvl numeric;
begin
  select * into d from public.deposits where id = p_deposit for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
  if d.status <> 'pending_confirm' then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if coalesce(array_length(p_levels, 1), 0) <> d.quantity then raise exception 'LEVELS_MISMATCH' using errcode = '22023'; end if;
  if coalesce(array_length(p_photo_paths, 1), 0) = 0 then raise exception 'PHOTO_REQUIRED' using errcode = '22023'; end if;

  for i in 1..d.quantity loop
    lvl := p_levels[i];
    if lvl is null or lvl < 0 or lvl > 100 then raise exception 'BAD_LEVEL' using errcode = '22023'; end if;
    update public.deposit_bottles set remaining_percent = lvl,
      status = case when lvl = 0 then 'consumed'::public.bottle_status when lvl < 100 then 'opened' else 'sealed' end,
      consumed_at = case when lvl = 0 then now() end, consumed_by = case when lvl = 0 then auth.uid() end
    where deposit_id = d.id and bottle_no = i;
  end loop;

  update public.deposits set confirmed_by = auth.uid(), confirmed_at = now(), confirm_photo_paths = p_photo_paths
  where id = d.id;
  st := private.refresh_deposit(d.id);
  perform private.log_event(d.id, d.branch_id, 'confirmed', jsonb_build_object('levels', to_jsonb(p_levels)));
  perform private.notify_customer(d.id, 'deposit_confirmed', '{}'::jsonb, 'deposit_confirmed:' || d.id);
  return jsonb_build_object('id', d.id, 'status', st);
end $$;

create or replace function public.reject_deposit(p_deposit uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype;
begin
  select * into d from public.deposits where id = p_deposit for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
  if d.status not in ('requested', 'pending_confirm') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  -- RULINGS R-003: a rejection is always `cancelled`
  update public.deposits set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
    cancel_reason = nullif(btrim(p_reason), '')
  where id = d.id;
  perform private.log_event(d.id, d.branch_id, 'rejected', jsonb_build_object('reason', p_reason));
  perform private.notify_customer(d.id, 'deposit_rejected', jsonb_build_object('reason', p_reason), 'deposit_rejected:' || d.id);
  return jsonb_build_object('id', d.id, 'status', 'cancelled');
end $$;

-- withdrawal request by staff (authenticated) or by the customer (service role + p_customer_id)
create or replace function public.request_withdrawal(
  p_deposit uuid, p_bottle_ids uuid[], p_type public.withdrawal_type,
  p_table text default null, p_notes text default null, p_customer_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.deposits%rowtype;
  n int;
  blocked text[];
  night date;
  by_cust boolean := false;
  ids uuid[];
begin
  select * into d from public.deposits where id = p_deposit for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if private.is_service() then
    if p_customer_id is null or d.customer_id is distinct from p_customer_id then
      raise exception 'NOT_YOURS' using errcode = '42501';
    end if;
    by_cust := true;
  else
    perform private.require_role(d.branch_id, array['staff', 'bar', 'owner']::public.user_role[]);
  end if;
  if d.status not in ('in_store', 'pending_withdrawal') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  n := coalesce(array_length(p_bottle_ids, 1), 0);
  if n = 0 then raise exception 'NO_BOTTLES' using errcode = '22023'; end if;
  if (select count(*) from public.deposit_bottles b where b.deposit_id = d.id and b.id = any (p_bottle_ids) and b.status <> 'consumed') <> n then
    raise exception 'BAD_BOTTLES' using errcode = '22023';
  end if;
  if p_type = 'in_store' then
    select withdrawal_blocked_days into blocked from public.branches where id = d.branch_id;
    night := private.business_night(now());
    if private.dow_name(night) = any (blocked) then raise exception 'WITHDRAW_BLOCKED_DAY' using errcode = '22023'; end if;
  end if;

  with ins as (
    insert into public.withdrawals (deposit_id, branch_id, bottle_id, type, by_customer, customer_id, requested_by, table_label, notes)
    select d.id, d.branch_id, b, p_type, by_cust, case when by_cust then p_customer_id end,
      case when by_cust then null else auth.uid() end, nullif(btrim(p_table), ''), nullif(btrim(p_notes), '')
    from unnest(p_bottle_ids) as b
    returning id
  )
  select array_agg(id) into ids from ins;

  perform private.refresh_deposit(d.id);
  perform private.log_event(d.id, d.branch_id, 'withdrawal_requested',
    jsonb_build_object('count', n, 'type', p_type, 'table', p_table), case when by_cust then 'customer' else 'staff' end);
  perform private.notify_staff_group(d.branch_id, 'withdrawal_requested',
    jsonb_build_object('deposit_id', d.id, 'code', d.code, 'item', d.item_name, 'customer', d.customer_name,
      'count', n, 'table', p_table, 'type', p_type), 'withdrawal_requested:' || ids[1]);
  return jsonb_build_object('deposit_id', d.id, 'withdrawal_ids', to_jsonb(ids));
exception when unique_violation then
  raise exception 'ALREADY_REQUESTED' using errcode = '23505';
end $$;

-- ported from Davis complete_deposit_withdrawals: whole bottles, one deposit, all-or-nothing
create or replace function public.complete_withdrawals(p_withdrawal_ids uuid[], p_photo_path text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n int := coalesce(array_length(p_withdrawal_ids, 1), 0);
  dep_ids uuid[];
  d public.deposits%rowtype;
  changed int;
  st public.deposit_status;
  nos int[];
  tbl text;
  typ public.withdrawal_type;
begin
  if n = 0 or n > 50 then raise exception 'BAD_COUNT' using errcode = '22023'; end if;
  select array_agg(distinct w.deposit_id) into dep_ids from public.withdrawals w where w.id = any (p_withdrawal_ids);
  if coalesce(array_length(dep_ids, 1), 0) <> 1 then raise exception 'ONE_DEPOSIT_ONLY' using errcode = '22023'; end if;
  select * into d from public.deposits where id = dep_ids[1] for update;
  perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);

  update public.withdrawals w set status = 'completed', processed_by = auth.uid(), processed_at = now(),
    photo_path = coalesce(p_photo_path, w.photo_path), notes = coalesce(nullif(btrim(p_notes), ''), w.notes)
  where w.id = any (p_withdrawal_ids) and w.status = 'pending';
  get diagnostics changed = row_count;
  if changed <> n then raise exception 'WITHDRAWAL_CHANGED' using errcode = '40001'; end if;

  update public.deposit_bottles b set status = 'consumed', remaining_percent = 0, consumed_at = now(), consumed_by = auth.uid()
  where b.id in (select w.bottle_id from public.withdrawals w where w.id = any (p_withdrawal_ids) and w.bottle_id is not null);

  select array_agg(b.bottle_no order by b.bottle_no), min(w.table_label), min(w.type::text)::public.withdrawal_type
    into nos, tbl, typ
  from public.withdrawals w join public.deposit_bottles b on b.id = w.bottle_id where w.id = any (p_withdrawal_ids);

  st := private.refresh_deposit(d.id);
  perform private.log_event(d.id, d.branch_id, 'withdrawal_completed',
    jsonb_build_object('bottles', to_jsonb(nos), 'table', tbl, 'type', typ));
  perform private.notify_customer(d.id, 'withdraw_completed', jsonb_build_object('count', n), 'withdraw_completed:' || p_withdrawal_ids[1]);
  return jsonb_build_object('deposit_id', d.id, 'status', st);
end $$;

create or replace function public.reject_withdrawal(p_withdrawal_ids uuid[], p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int := coalesce(array_length(p_withdrawal_ids, 1), 0); dep_ids uuid[]; d public.deposits%rowtype; changed int; st public.deposit_status;
begin
  if n = 0 then raise exception 'BAD_COUNT' using errcode = '22023'; end if;
  select array_agg(distinct w.deposit_id) into dep_ids from public.withdrawals w where w.id = any (p_withdrawal_ids);
  if coalesce(array_length(dep_ids, 1), 0) <> 1 then raise exception 'ONE_DEPOSIT_ONLY' using errcode = '22023'; end if;
  select * into d from public.deposits where id = dep_ids[1] for update;
  perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
  update public.withdrawals set status = 'rejected', processed_by = auth.uid(), processed_at = now(),
    reject_reason = nullif(btrim(p_reason), '')
  where id = any (p_withdrawal_ids) and status = 'pending';
  get diagnostics changed = row_count;
  if changed <> n then raise exception 'WITHDRAWAL_CHANGED' using errcode = '40001'; end if;
  st := private.refresh_deposit(d.id);
  perform private.log_event(d.id, d.branch_id, 'withdrawal_rejected', jsonb_build_object('reason', p_reason, 'count', n));
  perform private.notify_customer(d.id, 'withdraw_rejected', jsonb_build_object('reason', p_reason), 'withdraw_rejected:' || p_withdrawal_ids[1]);
  return jsonb_build_object('deposit_id', d.id, 'status', st);
end $$;

create or replace function public.extend_deposit(p_deposit uuid, p_days integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; new_exp timestamptz;
begin
  select * into d from public.deposits where id = p_deposit for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
  if d.status not in ('in_store', 'pending_withdrawal', 'expired') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if d.is_vip then raise exception 'VIP_NO_EXPIRY' using errcode = '22023'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'BAD_DAYS' using errcode = '22023'; end if;
  new_exp := greatest(coalesce(d.expires_at, now()), now()) + make_interval(days => p_days);
  update public.deposits set expires_at = new_exp, expiry_notice_sent_at = null, expired_notice_sent_at = null,
    status = case when d.status = 'expired' then 'in_store'::public.deposit_status else d.status end
  where id = d.id;
  if d.status = 'expired' then perform private.refresh_deposit(d.id); end if;
  perform private.log_event(d.id, d.branch_id, 'extended', jsonb_build_object('days', p_days, 'expires_at', new_exp));
  return jsonb_build_object('id', d.id, 'expires_at', new_exp);
end $$;

create or replace function public.set_vip(p_deposit uuid, p_vip boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; days integer;
begin
  select * into d from public.deposits where id = p_deposit for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
  if d.status not in ('in_store', 'pending_withdrawal', 'pending_confirm', 'expired') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if d.is_vip = p_vip then return jsonb_build_object('id', d.id, 'is_vip', p_vip); end if;
  select deposit_days into days from public.branches where id = d.branch_id;
  update public.deposits set is_vip = p_vip,
    expires_at = case when p_vip then null else now() + make_interval(days => days) end,
    expiry_notice_sent_at = null, expired_notice_sent_at = null,
    status = case when d.status = 'expired' and p_vip then 'in_store'::public.deposit_status else d.status end
  where id = d.id;
  if d.status = 'expired' and p_vip then perform private.refresh_deposit(d.id); end if;
  perform private.log_event(d.id, d.branch_id, case when p_vip then 'vip_on' else 'vip_off' end, '{}'::jsonb);
  return jsonb_build_object('id', d.id, 'is_vip', p_vip);
end $$;

create or replace function public.dispose_deposits(p_deposit_ids uuid[], p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int := coalesce(array_length(p_deposit_ids, 1), 0); d record; changed int;
begin
  if n = 0 or n > 200 then raise exception 'BAD_COUNT' using errcode = '22023'; end if;
  for d in select id, branch_id, status from public.deposits where id = any (p_deposit_ids) order by id for update loop
    perform private.require_role(d.branch_id, array['bar', 'owner']::public.user_role[]);
    if d.status <> 'expired' then raise exception 'NOT_EXPIRED' using errcode = '22023'; end if;
  end loop;
  update public.deposits set status = 'disposed', disposed_by = auth.uid(), disposed_at = now(),
    dispose_reason = nullif(btrim(p_reason), '')
  where id = any (p_deposit_ids) and status = 'expired';
  get diagnostics changed = row_count;
  if changed <> n then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  for d in select id, branch_id from public.deposits where id = any (p_deposit_ids) loop
    perform private.log_event(d.id, d.branch_id, 'disposed', jsonb_build_object('reason', p_reason));
    perform private.notify_customer(d.id, 'disposed', '{}'::jsonb, 'disposed:' || d.id);
  end loop;
  return jsonb_build_object('count', changed);
end $$;

-- cron: in_store past the collection deadline → expired. A pending withdrawal holds it (Davis).
create or replace function public.expire_due_deposits()
returns integer language plpgsql security definer set search_path = '' as $$
declare d record; n int := 0;
begin
  if not (private.is_service() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  for d in
    update public.deposits set status = 'expired', expired_notice_sent_at = now()
    where status = 'in_store' and not is_vip and collect_deadline_at is not null and collect_deadline_at <= now()
    returning id, branch_id
  loop
    n := n + 1;
    insert into public.deposit_events (deposit_id, branch_id, actor_kind, action) values (d.id, d.branch_id, 'system', 'expired');
    perform private.notify_customer(d.id, 'expired', '{}'::jsonb, 'expired:' || d.id);
  end loop;
  return n;
end $$;

-- cron: one "expiring soon" message per deposit, N days before expiry (branch setting)
create or replace function public.send_expiry_notices()
returns integer language plpgsql security definer set search_path = '' as $$
declare d record; n int := 0;
begin
  if not (private.is_service() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  for d in
    update public.deposits dep set expiry_notice_sent_at = now()
    from public.branches b
    where b.id = dep.branch_id and dep.status in ('in_store', 'pending_withdrawal') and not dep.is_vip
      and dep.expiry_notice_sent_at is null and dep.expires_at is not null and dep.customer_id is not null
      and dep.expires_at <= now() + make_interval(days => b.expiry_notice_days)
    returning dep.id
  loop
    n := n + 1;
    perform private.notify_customer(d.id, 'expiry_soon', '{}'::jsonb, 'expiry_soon:' || d.id);
  end loop;
  return n;
end $$;

-- customer (service role, after LINE verification): a deposit request from LIFF
create or replace function public.customer_request_deposit(
  p_branch uuid, p_customer_id uuid, p_customer_name text, p_item_name text, p_quantity integer,
  p_terms_version text, p_terms_locale public.app_locale,
  p_customer_phone text default null, p_table text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_id uuid; new_code text; tries int := 0;
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.branches where id = p_branch and active) then raise exception 'BRANCH_INACTIVE' using errcode = '22023'; end if;
  if p_terms_version is null then raise exception 'TERMS_REQUIRED' using errcode = '22023'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 50 then raise exception 'BAD_QUANTITY' using errcode = '22023'; end if;
  loop
    tries := tries + 1;
    new_code := private.new_deposit_code(p_branch);
    begin
      insert into public.deposits (branch_id, code, source, customer_id, customer_name, customer_phone, table_label,
        item_name, quantity, remaining_qty, status, notes, terms_accepted_at, terms_version, terms_locale)
      values (p_branch, new_code, 'line', p_customer_id, btrim(p_customer_name), nullif(btrim(p_customer_phone), ''),
        nullif(btrim(p_table), ''), btrim(p_item_name), p_quantity, 0, 'requested', nullif(btrim(p_notes), ''),
        now(), p_terms_version, p_terms_locale)
      returning id into new_id;
      exit;
    exception when unique_violation then
      if tries >= 8 then raise exception 'CODE_EXHAUSTED'; end if;
    end;
  end loop;
  -- quantity is the customer's claim; remaining starts at 0 until staff receive the bottles
  update public.deposits set remaining_qty = 0 where id = new_id;
  insert into public.deposit_events (deposit_id, branch_id, actor_kind, action, payload)
  values (new_id, p_branch, 'customer', 'requested', jsonb_build_object('count', p_quantity));
  perform private.notify_staff_group(p_branch, 'deposit_requested',
    jsonb_build_object('deposit_id', new_id, 'code', new_code, 'customer', p_customer_name, 'item', p_item_name,
      'count', p_quantity, 'table', p_table), 'deposit_requested:' || new_id);
  return jsonb_build_object('id', new_id, 'code', new_code);
end $$;

-- customer scanned a receipt QR / typed a code in LINE: attach their LINE identity (service role)
create or replace function public.link_deposit_customer(p_code text, p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype;
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into d from public.deposits where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if d.customer_id is not null and d.customer_id <> p_customer_id then raise exception 'NOT_YOURS' using errcode = '42501'; end if;
  if d.status in ('withdrawn', 'disposed', 'cancelled') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if d.customer_id is null then
    update public.deposits set customer_id = p_customer_id where id = d.id;
    insert into public.deposit_events (deposit_id, branch_id, actor_kind, action) values (d.id, d.branch_id, 'customer', 'line_linked');
  end if;
  return jsonb_build_object('id', d.id, 'code', d.code, 'branch_id', d.branch_id);
end $$;

-- ── RLS + grants ─────────────────────────────────────────────────────────
alter table public.deposits enable row level security;
alter table public.deposit_bottles enable row level security;
alter table public.withdrawals enable row level security;
alter table public.deposit_events enable row level security;
alter table public.line_outbox enable row level security;

revoke all on public.deposits, public.deposit_bottles, public.withdrawals, public.deposit_events, public.line_outbox
  from public, anon, authenticated;
grant select on public.deposits, public.deposit_bottles, public.withdrawals, public.deposit_events to authenticated;
-- line_outbox: service role only

create policy deposits_select on public.deposits for select to authenticated
  using (private.is_member(branch_id));
create policy deposit_bottles_select on public.deposit_bottles for select to authenticated
  using (exists (select 1 from public.deposits d where d.id = deposit_id and private.is_member(d.branch_id)));
create policy withdrawals_select on public.withdrawals for select to authenticated
  using (private.is_member(branch_id));
create policy deposit_events_select on public.deposit_events for select to authenticated
  using (private.is_member(branch_id));

-- customers of a deposit in one of my branches become visible to that branch's staff
create policy customers_select_member on public.customers for select to authenticated
  using (exists (select 1 from public.deposits d where d.customer_id = customers.id and private.is_member(d.branch_id)));

-- functions: nothing for anon; RPCs for authenticated (+ service); service-only ones locked down
revoke all on function public.create_deposit(uuid, text, text, integer, text[], text, text, uuid, text, text, timestamptz, uuid) from public, anon;
revoke all on function public.staff_receive_request(uuid, integer, text[], text, uuid, text, text) from public, anon;
revoke all on function public.confirm_deposit(uuid, numeric[], text[]) from public, anon;
revoke all on function public.reject_deposit(uuid, text) from public, anon;
revoke all on function public.request_withdrawal(uuid, uuid[], public.withdrawal_type, text, text, uuid) from public, anon;
revoke all on function public.complete_withdrawals(uuid[], text, text) from public, anon;
revoke all on function public.reject_withdrawal(uuid[], text) from public, anon;
revoke all on function public.extend_deposit(uuid, integer) from public, anon;
revoke all on function public.set_vip(uuid, boolean) from public, anon;
revoke all on function public.dispose_deposits(uuid[], text) from public, anon;
revoke all on function public.expire_due_deposits() from public, anon, authenticated;
revoke all on function public.send_expiry_notices() from public, anon, authenticated;
revoke all on function public.customer_request_deposit(uuid, uuid, text, text, integer, text, public.app_locale, text, text, text) from public, anon, authenticated;
revoke all on function public.link_deposit_customer(text, uuid) from public, anon, authenticated;

grant execute on function public.create_deposit(uuid, text, text, integer, text[], text, text, uuid, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.staff_receive_request(uuid, integer, text[], text, uuid, text, text) to authenticated;
grant execute on function public.confirm_deposit(uuid, numeric[], text[]) to authenticated;
grant execute on function public.reject_deposit(uuid, text) to authenticated;
grant execute on function public.request_withdrawal(uuid, uuid[], public.withdrawal_type, text, text, uuid) to authenticated, service_role;
grant execute on function public.complete_withdrawals(uuid[], text, text) to authenticated;
grant execute on function public.reject_withdrawal(uuid[], text) to authenticated;
grant execute on function public.extend_deposit(uuid, integer) to authenticated;
grant execute on function public.set_vip(uuid, boolean) to authenticated;
grant execute on function public.dispose_deposits(uuid[], text) to authenticated;
grant execute on function public.expire_due_deposits() to service_role;
grant execute on function public.send_expiry_notices() to service_role;
grant execute on function public.customer_request_deposit(uuid, uuid, text, text, integer, text, public.app_locale, text, text, text) to service_role;
grant execute on function public.link_deposit_customer(text, uuid) to service_role;

-- private helpers: never callable by anon; the RPCs call them as definer
revoke all on function private.business_night(timestamptz) from public, anon;
revoke all on function private.dow_name(date) from public, anon;
revoke all on function private.deposit_collection_deadline(timestamptz, text[]) from public, anon;
revoke all on function private.require_role(uuid, public.user_role[]) from public, anon, authenticated;
revoke all on function private.is_service() from public, anon;
revoke all on function private.log_event(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function private.enqueue_line(uuid, text, text, text, public.app_locale, jsonb, text) from public, anon, authenticated;
revoke all on function private.notify_customer(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function private.notify_staff_group(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function private.refresh_deposit(uuid) from public, anon, authenticated;
revoke all on function private.new_deposit_code(uuid) from public, anon, authenticated;
revoke all on function private.set_deposit_collection_deadline() from public, anon, authenticated;
revoke all on function private.guard_withdrawal_deadline() from public, anon, authenticated;
revoke all on function private.auto_create_deposit_bottles() from public, anon, authenticated;
grant execute on function private.business_night(timestamptz) to authenticated, service_role;
grant execute on function private.dow_name(date) to authenticated, service_role;
grant execute on function private.deposit_collection_deadline(timestamptz, text[]) to authenticated, service_role;
grant execute on function private.is_service() to authenticated, service_role;
