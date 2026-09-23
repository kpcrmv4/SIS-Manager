-- Print: keep Davis's proven print-server (Puppeteer + SumatraPDF) and make the database speak
-- its language (RULINGS R-021). Plus the 6-character LINE link code printed on the customer's
-- receipt (owner decision 2026-09-23: a secret code on the receipt, never the DEP code on the label).

-- ── print_jobs ↔ Davis print_queue shape ─────────────────────────────────
alter type public.print_status rename value 'done' to 'completed';
alter table public.print_jobs rename column type to job_type;
alter table public.print_jobs rename column error to error_message;
drop trigger if exists print_jobs_broadcast on public.print_jobs;         -- Davis listens with postgres_changes
drop function if exists private.broadcast_print_job();
do $$ begin
  alter publication supabase_realtime add table public.print_jobs;
exception when duplicate_object then null; end $$;

-- ── print_stations ↔ Davis print_server_status (heartbeat upsert on branch_id) ─
alter table public.print_stations rename column last_seen_at to last_heartbeat;
alter table public.print_stations rename column version to server_version;
alter table public.print_stations
  add column if not exists is_online boolean not null default false,
  add column if not exists printer_status text,
  add column if not exists hostname text,
  add column if not exists error_message text,
  add column if not exists updated_at timestamptz not null default now();
revoke update on public.print_stations from authenticated;
grant insert (branch_id, is_online, last_heartbeat, server_version, printer_name, printer_status, hostname, error_message, updated_at)
  on public.print_stations to authenticated;
grant update (is_online, last_heartbeat, server_version, printer_name, printer_status, hostname, error_message, updated_at)
  on public.print_stations to authenticated;
drop policy if exists print_stations_insert on public.print_stations;
create policy print_stations_insert on public.print_stations for insert to authenticated
  with check (branch_id = (select private.print_branch()));

-- ── the print account reads its own branch's print settings (Davis store_settings) ─
alter table public.branches
  add column if not exists print_server_working_hours jsonb,
  add column if not exists print_server_printer_name text;
drop policy if exists branches_select_print on public.branches;
create policy branches_select_print on public.branches for select to authenticated
  using (id = (select private.print_branch()));

-- ── LINE link code: 6 characters, secret, only on the customer's receipt ─
create or replace function private.new_link_code()
returns text language plpgsql volatile set search_path = '' as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; s text := ''; i int;
begin
  for i in 1..6 loop s := s || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
  return s;
end $$;
alter table public.deposits add column if not exists link_code text;
update public.deposits set link_code = private.new_link_code() where link_code is null;
alter table public.deposits alter column link_code set default private.new_link_code();
alter table public.deposits alter column link_code set not null;
create unique index if not exists deposits_link_code_uniq on public.deposits (branch_id, link_code);

-- link by the receipt's QR token OR the typed 6-character code, always within the branch
create or replace function public.link_deposit_customer(p_branch uuid, p_token text, p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; ref text := btrim(coalesce(p_token, ''));
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into d from public.deposits
  where branch_id = p_branch and (link_token = lower(ref) or link_code = upper(ref))
  for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if d.customer_id is not null and d.customer_id <> p_customer_id then raise exception 'NOT_YOURS' using errcode = '42501'; end if;
  if d.status in ('withdrawn', 'disposed', 'cancelled') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if d.customer_id is null then
    update public.deposits set customer_id = p_customer_id where id = d.id;
    insert into public.deposit_events (deposit_id, branch_id, actor_kind, action) values (d.id, d.branch_id, 'customer', 'line_linked');
  end if;
  return jsonb_build_object('id', d.id, 'code', d.code, 'branch_id', d.branch_id);
end $$;

-- ── queue_print builds Davis's payload keys from the deposit row ─────────
create or replace function public.queue_print(p_deposit uuid, p_type text, p_copies integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; b public.branches%rowtype; job uuid; who text; copies int; bottles jsonb;
begin
  select * into d from public.deposits where id = p_deposit;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['staff', 'bar', 'owner']::public.user_role[]);
  if p_type not in ('receipt', 'label') then raise exception 'BAD_TYPE' using errcode = '22023'; end if;
  if d.status in ('requested', 'cancelled') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  select * into b from public.branches where id = d.branch_id;
  select display_name into who from public.profiles where id = d.received_by;
  select coalesce(jsonb_agg(jsonb_build_object('bottle_no', x.bottle_no, 'remaining_percent', x.remaining_percent) order by x.bottle_no), '[]'::jsonb)
    into bottles from public.deposit_bottles x where x.deposit_id = d.id and x.status <> 'consumed';
  copies := greatest(1, least(coalesce(p_copies, (b.receipt_settings ->> 'copies')::int, 1), 5));
  insert into public.print_jobs (branch_id, deposit_id, job_type, copies, payload, requested_by)
  values (d.branch_id, d.id, p_type, copies, jsonb_build_object(
    'deposit_code', d.code,
    'link_code', case when p_type = 'receipt' then d.link_code end,
    'customer_name', d.customer_name,
    'customer_phone', d.customer_phone,
    'product_name', d.item_name,
    'quantity', d.quantity,
    'remaining_qty', d.remaining_qty,
    'remaining_percent', d.remaining_percent,
    'table_number', d.table_label,
    'created_at', coalesce(d.received_at, d.created_at),
    'expiry_date', d.expires_at,
    'is_vip', d.is_vip,
    'received_by_name', who,
    'bottles', bottles), auth.uid())
  returning id into job;
  perform private.log_event(d.id, d.branch_id, 'printed', jsonb_build_object('type', p_type));
  return jsonb_build_object('id', job);
end $$;
