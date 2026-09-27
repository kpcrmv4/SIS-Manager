-- R-058 · (owner request) ผูก LINE ด้วย QR ที่พนักงานยื่นให้ลูกค้าสแกน.
-- Staff open a deposit that has no LINE account yet and press "ให้ลูกค้าสแกนผูก LINE": the sheet shows
-- a QR of https://liff.line.me/<liff id>/link?t=<token>. The token works once, for 10 minutes, and dies
-- the moment the sheet closes (revoke_link_qr). The customer scans with the phone camera, LINE opens
-- the branch's LIFF, which proves who they are (LIFF login), and customer_link_by_qr links:
--   · the scanned deposit (already theirs → said so, nothing changes; another LINE account's → refused);
--   · every other deposit of the same phone at this branch still waiting for a LINE account, unless that
--     phone already belongs to a different LINE customer (private.phone_owner).
-- Before showing the QR the sheet says whether this phone already has a LINE customer here (and who),
-- or is new. Only a hash of the token is stored; the table has no policy — RPCs only.

create table if not exists public.deposit_link_qr (
  deposit_id uuid primary key references public.deposits (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  token_hash text not null,
  issued_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.deposit_link_qr is 'R-058: the one live link QR of a deposit — sha256 of the token, 10 minutes, removed when used or when the staff sheet closes.';
create unique index if not exists deposit_link_qr_token_uniq on public.deposit_link_qr (token_hash);
create index if not exists deposit_link_qr_branch_idx on public.deposit_link_qr (branch_id);
create index if not exists deposit_link_qr_issued_by_idx on public.deposit_link_qr (issued_by) where issued_by is not null;

alter table public.deposit_link_qr enable row level security;
revoke all on public.deposit_link_qr from public, anon, authenticated;

create or replace function private.link_qr_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(lower(btrim(coalesce(p_token, ''))), 'sha256'), 'hex')
$$;
revoke all on function private.link_qr_hash(text) from public, anon, authenticated;

-- ── staff: a fresh QR (any earlier one of this deposit stops working) ─────
create or replace function public.issue_link_qr(p_deposit uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; liff text; tok text; exp timestamptz; k text; owner uuid; owner_name text; waiting int := 0;
begin
  select * into d from public.deposits where id = p_deposit;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['staff', 'bar', 'owner']::public.user_role[]);
  if d.status in ('withdrawn', 'disposed', 'cancelled') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if d.customer_id is not null then raise exception 'ALREADY_LINKED' using errcode = '22023'; end if;
  select nullif(btrim(liff_id), '') into liff from public.branches where id = d.branch_id;
  if liff is null then raise exception 'NO_LIFF' using errcode = '22023'; end if;

  delete from public.deposit_link_qr where branch_id = d.branch_id and expires_at < now() - interval '1 day';
  tok := encode(extensions.gen_random_bytes(16), 'hex');
  exp := now() + interval '10 minutes';
  insert into public.deposit_link_qr (deposit_id, branch_id, token_hash, issued_by, expires_at)
  values (d.id, d.branch_id, private.link_qr_hash(tok), auth.uid(), exp)
  on conflict (deposit_id) do update set token_hash = excluded.token_hash, issued_by = excluded.issued_by,
    expires_at = excluded.expires_at, created_at = now();

  k := private.phone_key(d.customer_phone);
  if k is not null then
    owner := private.phone_owner(d.branch_id, k);
    if owner is not null then select display_name into owner_name from public.customers where id = owner; end if;
    select count(*) into waiting from public.deposits x
    where x.branch_id = d.branch_id and x.id <> d.id and x.customer_id is null
      and x.status not in ('withdrawn', 'disposed', 'cancelled') and private.phone_key(x.customer_phone) = k;
  end if;

  return jsonb_build_object('token', tok, 'expires_at', exp, 'liff_id', liff,
    'known', owner is not null, 'known_name', owner_name,
    -- a phone that is already another LINE customer's links only the scanned deposit
    'also', case when owner is null then waiting else 0 end);
end $$;

-- ── staff: the sheet closed — the QR is dead ─────────────────────────────
create or replace function public.revoke_link_qr(p_deposit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  select branch_id into b from public.deposits where id = p_deposit;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(b, array['staff', 'bar', 'owner']::public.user_role[]);
  delete from public.deposit_link_qr where deposit_id = p_deposit;
end $$;

-- ── staff: what the open sheet shows — still waiting, expired, or linked (and to whom) ─
create or replace function public.link_qr_status(p_deposit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d public.deposits%rowtype; ev jsonb; nm text; live boolean;
begin
  select * into d from public.deposits where id = p_deposit;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(d.branch_id, array['staff', 'bar', 'owner']::public.user_role[]);
  live := exists (select 1 from public.deposit_link_qr q where q.deposit_id = d.id and q.expires_at > now());
  if d.customer_id is null then return jsonb_build_object('linked', false, 'live', live); end if;
  select display_name into nm from public.customers where id = d.customer_id;
  select e.payload into ev from public.deposit_events e
  where e.deposit_id = d.id and e.action = 'line_linked' order by e.created_at desc limit 1;
  return jsonb_build_object('linked', true, 'live', false, 'name', nm,
    'via_qr', coalesce(ev ->> 'via', '') = 'qr',
    'returning', coalesce((ev ->> 'returning')::boolean, false),
    'count', coalesce((ev ->> 'count')::int, 1));
end $$;

-- ── customer (service role, after the LIFF login): scan → link ────────────
create or replace function public.customer_link_by_qr(p_branch uuid, p_customer uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lu text; loc public.app_locale; fails int; q public.deposit_link_qr%rowtype; d public.deposits%rowtype;
  k text; owner uuid; was_known boolean; already boolean; ids uuid[]; bot text;
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select line_user_id, locale into lu, loc from public.customers where id = p_customer;
  if lu is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- the same throttle as a typed receipt code (line_link_attempt): 5 misses / 15 minutes / LINE user / branch
  perform pg_advisory_xact_lock(hashtextextended(p_branch::text || ':' || lu, 0));
  select count(*) into fails from public.line_link_failures
  where branch_id = p_branch and line_user_id = lu and created_at > now() - interval '15 minutes';
  if fails >= 5 then return jsonb_build_object('ok', false, 'error', 'THROTTLED'); end if;

  select * into q from public.deposit_link_qr
  where token_hash = private.link_qr_hash(p_token) and branch_id = p_branch
  for update;
  if not found or q.expires_at <= now() then
    insert into public.line_link_failures (branch_id, line_user_id) values (p_branch, lu);
    return jsonb_build_object('ok', false, 'error', 'EXPIRED');
  end if;
  delete from public.deposit_link_qr where deposit_id = q.deposit_id;  -- one scan only

  select * into d from public.deposits where id = q.deposit_id for update;
  if d.status in ('withdrawn', 'disposed', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'BAD_STATE'); end if;
  if d.customer_id is not null and d.customer_id <> p_customer then return jsonb_build_object('ok', false, 'error', 'NOT_YOURS'); end if;
  already := d.customer_id is not null;
  -- a returning customer has any deposit or booking already on this LINE account
  was_known := exists (select 1 from public.deposits x where x.customer_id = p_customer and x.id <> d.id)
            or exists (select 1 from public.bookings b where b.customer_id = p_customer)
            or already;

  k := private.phone_key(d.customer_phone);
  owner := case when k is not null then private.phone_owner(p_branch, k) end;
  select coalesce(array_agg(x.id order by x.created_at), '{}') into ids from (
    select x.id, x.created_at from public.deposits x
    where x.branch_id = p_branch and x.customer_id is null
      and x.status not in ('withdrawn', 'disposed', 'cancelled')
      and (x.id = d.id or (k is not null and (owner is null or owner = p_customer) and private.phone_key(x.customer_phone) = k))
    for update
  ) x;

  if cardinality(ids) > 0 then
    update public.deposits set customer_id = p_customer where id = any (ids);
    insert into public.deposit_events (deposit_id, branch_id, actor_id, actor_kind, action, payload)
    select x, p_branch, null, 'customer', 'line_linked',
      jsonb_build_object('via', 'qr', 'issued_by', q.issued_by, 'returning', was_known, 'count', cardinality(ids), 'scanned', x = d.id)
    from unnest(ids) as x;
  end if;

  select nullif(btrim(line_bot_user_id), '') into bot from public.branches where id = p_branch;
  return jsonb_build_object('ok', true, 'already', already, 'returning', was_known, 'deposit_id', d.id, 'code', d.code,
    'linked', cardinality(ids), 'locale', loc, 'bot_user_id', bot);
end $$;

revoke all on function public.issue_link_qr(uuid) from public, anon;
revoke all on function public.revoke_link_qr(uuid) from public, anon;
revoke all on function public.link_qr_status(uuid) from public, anon;
revoke all on function public.customer_link_by_qr(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_link_qr(uuid) to authenticated;
grant execute on function public.revoke_link_qr(uuid) to authenticated;
grant execute on function public.link_qr_status(uuid) to authenticated;
grant execute on function public.customer_link_by_qr(uuid, uuid, text) to service_role;
