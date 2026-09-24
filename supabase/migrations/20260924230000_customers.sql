-- R-048 · Customers (owner request): one page for every customer of a branch — who they are, what
-- they keep here, every deposit and booking — and a VIP that belongs to the customer, not the bottle.
--
-- Who is one customer (no new customer rows — the records already say it):
--   · a LINE account (customer_id) is one customer;
--   · a phone, compared on its digits (dashes, spaces, +66 ignored), joins the one LINE customer who
--     used it at this branch (on a deposit or a booking, or as their own phone); a phone that two
--     LINE customers share stays a customer of its own;
--   · with neither, the name.
-- Keys: 'c-<customer uuid>' · 'p-<phone digits>' · 'n-<md5 of the trimmed, lower-cased name>'.
-- A page may also be opened by 'd-<deposit uuid>' or 'b-<booking uuid>' and lands on the customer.
--
-- VIP, per branch: customer_vips holds the customer's LINE id and their phones. Making a customer VIP
-- turns each deposit of theirs in store, waiting for bar or expired into VIP (no expiry; an expired
-- one back in store) exactly like set_vip; a deposit they make later — by phone in any format, or by
-- LINE — turns VIP by itself (a trigger, let past the bar-only guard for that and nothing else).
-- Cancelling counts their VIP deposits again from today (today + the branch's deposit days), like
-- set_vip(false). Staff read all of it; bar and owner change it.

-- ── a phone's digits, the same however it was typed ─────────────────────
create or replace function private.phone_key(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case
    when x.d ~ '^66[0-9]{8,9}$' then '0' || substr(x.d, 3)
    when length(x.d) between 6 and 15 then x.d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

create index if not exists deposits_branch_phone_key_idx on public.deposits (branch_id, (private.phone_key(customer_phone)));
create index if not exists bookings_branch_phone_key_idx on public.bookings (branch_id, (private.phone_key(phone)));
create index if not exists customers_phone_key_idx on public.customers ((private.phone_key(phone)));

-- ── the customers a branch made VIP ──────────────────────────────────────
create table if not exists public.customer_vips (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete cascade,
  phone_key text check (phone_key ~ '^[0-9]{6,15}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_vips_one_key check ((customer_id is null) <> (phone_key is null))
);
comment on table public.customer_vips is 'R-048: a customer this branch made VIP — one row per LINE id and per phone of theirs.';
create unique index if not exists customer_vips_customer_uniq on public.customer_vips (branch_id, customer_id) where customer_id is not null;
create unique index if not exists customer_vips_phone_uniq on public.customer_vips (branch_id, phone_key) where phone_key is not null;
create index if not exists customer_vips_customer_idx on public.customer_vips (customer_id) where customer_id is not null;
create index if not exists customer_vips_created_by_idx on public.customer_vips (created_by) where created_by is not null;

alter table public.customer_vips enable row level security;
revoke all on public.customer_vips from public, anon, authenticated;
grant select on public.customer_vips to authenticated;
drop policy if exists customer_vips_select_member on public.customer_vips;
create policy customer_vips_select_member on public.customer_vips for select to authenticated
  using (branch_id in (select private.my_branch_ids()));

-- open pages of the branch refresh when a customer turns VIP or stops being one
drop trigger if exists customer_vips_broadcast on public.customer_vips;
create trigger customer_vips_broadcast after insert or delete on public.customer_vips
  for each row execute function private.broadcast_branch_change();

-- ── who is who ───────────────────────────────────────────────────────────
-- the one LINE customer who used this phone at this branch (on a record, or as their own phone)
create or replace function private.phone_owner(p_branch uuid, p_key text)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when count(distinct x.cid) = 1 then min(x.cid::text)::uuid end
  from (
    select d.customer_id as cid from public.deposits d
    where d.branch_id = p_branch and d.customer_id is not null and private.phone_key(d.customer_phone) = p_key
    union all
    select b.customer_id from public.bookings b
    where b.branch_id = p_branch and b.customer_id is not null and private.phone_key(b.phone) = p_key
    union all
    select c.id from public.customers c
    where private.phone_key(c.phone) = p_key
      and (exists (select 1 from public.deposits d where d.branch_id = p_branch and d.customer_id = c.id)
        or exists (select 1 from public.bookings b where b.branch_id = p_branch and b.customer_id = c.id))
  ) x
$$;

-- a LINE customer's phones at this branch — the ones that are theirs alone
create or replace function private.customer_phones(p_branch uuid, p_customer uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.k), '{}')
  from (
    select private.phone_key(d.customer_phone) as k from public.deposits d where d.branch_id = p_branch and d.customer_id = p_customer
    union
    select private.phone_key(b.phone) from public.bookings b where b.branch_id = p_branch and b.customer_id = p_customer
    union
    select private.phone_key(c.phone) from public.customers c where c.id = p_customer
  ) x
  where x.k is not null and private.phone_owner(p_branch, x.k) = p_customer
$$;

-- the customer key of one set of details
create or replace function private.person_of(p_branch uuid, p_customer uuid, p_phone text, p_name text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare k text := private.phone_key(p_phone); o uuid;
begin
  if p_customer is not null then return 'c-' || p_customer; end if;
  if k is not null then
    o := private.phone_owner(p_branch, k);
    return case when o is not null then 'c-' || o else 'p-' || k end;
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is not null then return 'n-' || md5(lower(btrim(p_name))); end if;
  return null;
end $$;

-- any key a page was opened with → the customer's own key (null when it names nothing here)
create or replace function private.resolve_person(p_branch uuid, p_key text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v text := lower(btrim(coalesce(p_key, '')));
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  r record;
begin
  if v ~ ('^c-' || uuid_re || '$') or v ~ '^n-[0-9a-f]{32}$' then return v; end if;
  if v ~ '^p-[0-9]{6,15}$' then return private.person_of(p_branch, null, substr(v, 3), null); end if;
  if v ~ ('^d-' || uuid_re || '$') then
    select d.customer_id, d.customer_phone as phone, d.customer_name as name into r
    from public.deposits d where d.id = substr(v, 3)::uuid and d.branch_id = p_branch;
    if not found then return null; end if;
    return private.person_of(p_branch, r.customer_id, r.phone, r.name);
  end if;
  if v ~ ('^b-' || uuid_re || '$') then
    select b.customer_id, b.phone, b.name into r
    from public.bookings b where b.id = substr(v, 3)::uuid and b.branch_id = p_branch;
    if not found then return null; end if;
    return private.person_of(p_branch, r.customer_id, r.phone, r.name);
  end if;
  return null;
end $$;

-- every phone at this branch that exactly one LINE customer used
create or replace function private.branch_phone_owners(p_branch uuid)
returns table (phone_key text, customer_id uuid) language sql stable security definer set search_path = '' as $$
  with used as (
    select private.phone_key(d.customer_phone) as k, d.customer_id as cid from public.deposits d
    where d.branch_id = p_branch and d.customer_id is not null
    union
    select private.phone_key(b.phone), b.customer_id from public.bookings b
    where b.branch_id = p_branch and b.customer_id is not null
  ),
  own as (
    select u.k, u.cid from used u where u.k is not null
    union
    select private.phone_key(c.phone), c.id from public.customers c
    where c.id in (select u.cid from used u) and private.phone_key(c.phone) is not null
  )
  select o.k, min(o.cid::text)::uuid from own o group by o.k having count(distinct o.cid) = 1
$$;

-- every deposit ('d') and booking ('b') of a branch with the customer it belongs to
create or replace function private.branch_people_map(p_branch uuid)
returns table (kind text, id uuid, person text, customer_id uuid) language sql stable security definer set search_path = '' as $$
  with recs as (
    select 'd'::text as kind, d.id, d.customer_id as cid, private.phone_key(d.customer_phone) as k, d.customer_name as nm
    from public.deposits d where d.branch_id = p_branch
    union all
    select 'b', b.id, b.customer_id, private.phone_key(b.phone), b.name
    from public.bookings b where b.branch_id = p_branch
  )
  select r.kind, r.id,
    case when r.cid is not null then 'c-' || r.cid
         when o.customer_id is not null then 'c-' || o.customer_id
         when r.k is not null then 'p-' || r.k
         when nullif(btrim(coalesce(r.nm, '')), '') is not null then 'n-' || md5(lower(btrim(r.nm)))
    end,
    coalesce(r.cid, o.customer_id)
  from recs r left join private.branch_phone_owners(p_branch) o on o.phone_key = r.k
$$;

-- is the customer behind these details a VIP of this branch?
create or replace function private.customer_is_vip(p_branch uuid, p_customer uuid, p_phone text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  k text := private.phone_key(p_phone);
  cid uuid := p_customer;
  phones text[] := '{}';
begin
  if not exists (select 1 from public.customer_vips v where v.branch_id = p_branch) then return false; end if;
  if cid is null and k is not null then cid := private.phone_owner(p_branch, k); end if;
  -- this phone counts unless another LINE customer already has it
  if k is not null and (p_customer is null or coalesce(private.phone_owner(p_branch, k), p_customer) = p_customer) then
    phones := array[k];
  end if;
  if cid is not null then phones := phones || private.customer_phones(p_branch, cid); end if;
  return exists (
    select 1 from public.customer_vips v
    where v.branch_id = p_branch and ((cid is not null and v.customer_id = cid) or v.phone_key = any (phones)));
end $$;

-- ── a VIP customer's new deposits turn VIP by themselves ─────────────────
-- when it is taken, when a LINE request is received, and when it is linked to LINE later
create or replace function private.deposit_customer_vip()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_vip or new.status not in ('pending_confirm', 'in_store', 'pending_withdrawal') then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'requested'
     and old.customer_id is not distinct from new.customer_id
     and old.customer_phone is not distinct from new.customer_phone then
    return new;
  end if;
  if private.customer_is_vip(new.branch_id, new.customer_id, new.customer_phone) then
    new.is_vip := true;
    new.expires_at := null;
  end if;
  return new;
end $$;

-- the history says why (a system event — nobody pressed VIP on this deposit)
create or replace function private.deposit_customer_vip_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_vip then return null; end if;
  if tg_op = 'UPDATE' and (old.is_vip or (old.status <> 'requested'
       and old.customer_id is not distinct from new.customer_id
       and old.customer_phone is not distinct from new.customer_phone)) then
    return null;
  end if;
  if not private.customer_is_vip(new.branch_id, new.customer_id, new.customer_phone) then return null; end if;
  insert into public.deposit_events (deposit_id, branch_id, actor_kind, action, payload)
  values (new.id, new.branch_id, 'system', 'vip_on', jsonb_build_object('auto', 'customer'));
  return null;
end $$;

-- sorts before deposits_deadline, so the collection deadline sees the VIP
drop trigger if exists deposits_customer_vip on public.deposits;
create trigger deposits_customer_vip before insert or update of status, customer_id, customer_phone on public.deposits
  for each row execute function private.deposit_customer_vip();
drop trigger if exists deposits_customer_vip_log on public.deposits;
create trigger deposits_customer_vip_log after insert or update of status, customer_id, customer_phone on public.deposits
  for each row execute function private.deposit_customer_vip_log();

-- the bar-only guard lets exactly that through: VIP on, no expiry, for a VIP customer
create or replace function private.guard_deposit_expiry_vip()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_vip and not old.is_vip and new.expires_at is null
     and private.customer_is_vip(new.branch_id, new.customer_id, new.customer_phone) then
    return new;
  end if;
  if old.status = 'requested' and new.is_vip is not distinct from old.is_vip then return new; end if;
  if (new.expires_at is distinct from old.expires_at or new.is_vip is distinct from old.is_vip)
     and auth.role() is not null
     and auth.role() <> 'service_role'
     and coalesce(private.current_role()::text, '') not in ('bar', 'owner') then
    raise exception 'BAR_ONLY' using errcode = '42501';
  end if;
  return new;
end $$;

-- ── the list ─────────────────────────────────────────────────────────────
-- One page of customers for the filter and the search, the total, and the counts for the cards
-- (counted over everyone, without the filter or the search). Search: a name used, the LINE name,
-- a deposit or booking code, or the phone's digits (3 or more).
create or replace function public.customer_list(
  p_branch uuid, p_q text default null, p_filter text default 'all', p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_filter text := coalesce(nullif(btrim(coalesce(p_filter, '')), ''), 'all');
  v_like text;
  v_digits text;
  v_tonight date := private.business_night(now());
  v_out jsonb;
begin
  if not private.is_member(p_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_filter not in ('all', 'in_store', 'vip', 'line') then raise exception 'BAD_TYPE' using errcode = '22023'; end if;
  if v_q is not null then
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := regexp_replace(v_q, '[^0-9]', '', 'g');
    if length(v_digits) < 3 then v_digits := null; end if;
  end if;

  with m as (
    select mm.* from private.branch_people_map(p_branch) mm where mm.person is not null
  ),
  own as (select o.* from private.branch_phone_owners(p_branch) o),
  vip as (select v.customer_id, v.phone_key from public.customer_vips v where v.branch_id = p_branch),
  dep as (
    select m.person, d.created_at as at, d.customer_name as nm, d.customer_phone as ph, d.code,
      private.phone_key(d.customer_phone) as k, d.status, d.remaining_qty
    from m join public.deposits d on d.id = m.id where m.kind = 'd'
  ),
  bk as (
    select m.person, b.created_at as at, b.name as nm, b.phone as ph, b.code,
      private.phone_key(b.phone) as k, b.status, b.night
    from m join public.bookings b on b.id = m.id where m.kind = 'b'
  ),
  recs as (
    select dep.person, dep.at, dep.nm, dep.ph, dep.code, dep.k from dep
    union all
    select bk.person, bk.at, bk.nm, bk.ph, bk.code, bk.k from bk
  ),
  people as (
    select r.person,
      (array_agg(r.nm order by r.at desc) filter (where nullif(btrim(r.nm), '') is not null))[1] as name,
      (array_agg(r.ph order by r.at desc) filter (where nullif(btrim(r.ph), '') is not null))[1] as phone,
      max(r.at) as last_at,
      bool_or(v_q is null or r.nm ilike v_like or r.code ilike v_like
        or (v_digits is not null and r.k like '%' || v_digits || '%')) as hit
    from recs r group by r.person
  ),
  ds as (
    select dep.person,
      count(*) filter (where dep.status <> 'cancelled') as deposits,
      count(*) filter (where dep.status in ('in_store', 'pending_withdrawal')) as deposits_in_store,
      coalesce(sum(dep.remaining_qty) filter (where dep.status in ('in_store', 'pending_withdrawal')), 0) as bottles_in_store
    from dep group by dep.person
  ),
  bs as (
    select bk.person, count(*) as bookings,
      min(bk.night) filter (where bk.night >= v_tonight and bk.status in ('pending', 'confirmed')) as next_night
    from bk group by bk.person
  ),
  flagged as (
    select p.person, p.name, p.phone, p.last_at, p.hit, c.id as customer_id, c.display_name as line_name,
      coalesce(ds.deposits, 0) as deposits, coalesce(ds.deposits_in_store, 0) as deposits_in_store,
      coalesce(ds.bottles_in_store, 0) as bottles_in_store, coalesce(bs.bookings, 0) as bookings, bs.next_night,
      case
        when p.person like 'c-%' then exists (
          select 1 from vip v where v.customer_id = c.id
            or v.phone_key in (select o.phone_key from own o where o.customer_id = c.id))
        when p.person like 'p-%' then exists (select 1 from vip v where v.phone_key = substr(p.person, 3))
        else false
      end as is_vip
    from people p
    -- CASE, not AND: a 'p-' key must never reach the uuid cast
    left join public.customers c on c.id = case when p.person like 'c-%' then substr(p.person, 3)::uuid end
    left join ds on ds.person = p.person
    left join bs on bs.person = p.person
  ),
  hits as (
    select f.* from flagged f
    where (f.hit or (v_like is not null and f.line_name ilike v_like))
      and (v_filter = 'all'
        or (v_filter = 'in_store' and f.deposits_in_store > 0)
        or (v_filter = 'vip' and f.is_vip)
        or (v_filter = 'line' and f.customer_id is not null))
  ),
  page as (
    select h.* from hits h
    order by h.last_at desc nulls last, h.name, h.person
    limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'counts', (select jsonb_build_object(
        'all', count(*),
        'in_store', count(*) filter (where f.deposits_in_store > 0),
        'vip', count(*) filter (where f.is_vip),
        'line', count(*) filter (where f.customer_id is not null)) from flagged f),
    'total', (select count(*) from hits),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'key', pg.person, 'name', coalesce(pg.name, pg.line_name, ''), 'phone', pg.phone,
        'line', pg.customer_id is not null, 'line_name', pg.line_name,
        'is_vip', pg.is_vip, 'can_vip', pg.person not like 'n-%',
        'bottles_in_store', pg.bottles_in_store, 'deposits_in_store', pg.deposits_in_store,
        'deposits', pg.deposits, 'bookings', pg.bookings, 'next_night', pg.next_night, 'last_at', pg.last_at)
      order by pg.last_at desc nulls last, pg.name, pg.person) from page pg), '[]'::jsonb))
  into v_out;
  return v_out;
end $$;

-- ── one customer ─────────────────────────────────────────────────────────
-- null when the key names no one at this branch. Deposits and bookings come newest first, a page
-- of p_page each (offsets apart, so the two lists page on their own).
create or replace function public.customer_detail(
  p_branch uuid, p_key text, p_dep_offset integer default 0, p_bk_offset integer default 0, p_page integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_person text;
  v_cid uuid;
  v_phones text[] := '{}';
  v_dep uuid[];
  v_bk uuid[];
  v_page integer := greatest(1, least(coalesce(p_page, 20), 100));
  v_tonight date := private.business_night(now());
  v_out jsonb;
begin
  if not private.is_member(p_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_person := private.resolve_person(p_branch, p_key);
  if v_person is null then return null; end if;
  select coalesce(array_agg(m.id) filter (where m.kind = 'd'), '{}'), coalesce(array_agg(m.id) filter (where m.kind = 'b'), '{}')
    into v_dep, v_bk
  from private.branch_people_map(p_branch) m where m.person = v_person;
  if cardinality(v_dep) + cardinality(v_bk) = 0 then return null; end if;
  if v_person like 'c-%' then
    v_cid := substr(v_person, 3)::uuid;
    v_phones := private.customer_phones(p_branch, v_cid);
  elsif v_person like 'p-%' then
    v_phones := array[substr(v_person, 3)];
  end if;

  with recs as (
    select d.created_at as at, d.customer_name as nm, d.customer_phone as ph from public.deposits d where d.id = any (v_dep)
    union all
    select b.created_at, b.name, b.phone from public.bookings b where b.id = any (v_bk)
  ),
  names as (
    select r.nm, max(r.at) as at from recs r where nullif(btrim(r.nm), '') is not null group by r.nm
  ),
  phones as (
    select private.phone_key(r.ph) as k, (array_agg(r.ph order by r.at desc))[1] as ph, max(r.at) as at
    from recs r where private.phone_key(r.ph) is not null group by 1
  ),
  deps as (select d.* from public.deposits d where d.id = any (v_dep)),
  bks as (select b.* from public.bookings b where b.id = any (v_bk)),
  vip as (
    select v.created_at, v.created_by from public.customer_vips v
    where v.branch_id = p_branch and ((v_cid is not null and v.customer_id = v_cid) or v.phone_key = any (v_phones))
  ),
  next_bk as (
    select b.night, b.slot_time, b.code, b.status from bks b
    where b.night >= v_tonight and b.status in ('pending', 'confirmed')
    order by b.night, b.slot_time limit 1
  )
  select jsonb_build_object(
    'key', v_person,
    'name', coalesce((select n.nm from names n order by n.at desc limit 1), (select c.display_name from public.customers c where c.id = v_cid), ''),
    'names', coalesce((select jsonb_agg(x.nm order by x.at desc) from (select n.nm, n.at from names n order by n.at desc limit 6) x), '[]'::jsonb),
    'phones', coalesce((select jsonb_agg(x.ph order by x.at desc) from (select p.ph, p.at from phones p order by p.at desc limit 4) x), '[]'::jsonb),
    'line', (select jsonb_build_object('name', c.display_name, 'picture', c.picture_url, 'locale', c.locale,
               'reminders', c.expiry_notices_enabled) from public.customers c where c.id = v_cid),
    'can_vip', v_person not like 'n-%',
    'vip', (select jsonb_build_object('since', min(v.created_at),
               'by', (select coalesce(nullif(pr.display_name, ''), pr.username) from vip v2
                      join public.profiles pr on pr.id = v2.created_by order by v2.created_at limit 1))
            from vip v having count(*) > 0),
    'stats', jsonb_build_object(
      'bottles_in_store', (select coalesce(sum(d.remaining_qty), 0) from deps d where d.status in ('in_store', 'pending_withdrawal')),
      'deposits_in_store', (select count(*) from deps d where d.status in ('in_store', 'pending_withdrawal')),
      'deposits', (select count(*) from deps d where d.status <> 'cancelled'),
      'expired', (select count(*) from deps d where d.status = 'expired'),
      'bottles_withdrawn', (select count(*) from public.withdrawals w where w.deposit_id = any (v_dep) and w.status = 'completed'),
      'bookings', cardinality(v_bk),
      'arrived', (select count(*) from bks b where b.status = 'arrived'),
      'no_show', (select count(*) from bks b where b.status = 'no_show'),
      'cancelled', (select count(*) from bks b where b.status in ('cancelled', 'rejected')),
      'next_booking', (select jsonb_build_object('night', n.night, 'time', to_char(n.slot_time, 'HH24:MI'), 'code', n.code, 'status', n.status) from next_bk n),
      'first_at', (select min(r.at) from recs r),
      'last_at', (select max(r.at) from recs r)),
    'deposits', jsonb_build_object(
      'total', cardinality(v_dep),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'code', x.code, 'item', x.item_name, 'quantity', x.quantity, 'remaining_qty', x.remaining_qty,
          'remaining_percent', x.remaining_percent, 'status', x.status, 'is_vip', x.is_vip, 'expires_at', x.expires_at,
          'created_at', x.created_at, 'table', x.table_label, 'name', x.customer_name)
        order by x.created_at desc, x.id)
        from (select d.* from deps d order by d.created_at desc, d.id limit v_page offset greatest(0, coalesce(p_dep_offset, 0))) x), '[]'::jsonb)),
    'bookings', jsonb_build_object(
      'total', cardinality(v_bk),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'code', x.code, 'night', x.night, 'time', to_char(x.slot_time, 'HH24:MI'), 'party', x.party_size,
          'status', x.status, 'source', x.source, 'zone', z.name, 'table', t.label, 'name', x.name)
        order by x.night desc, x.slot_time desc, x.id)
        from (select b.* from bks b order by b.night desc, b.slot_time desc, b.id limit v_page offset greatest(0, coalesce(p_bk_offset, 0))) x
        left join public.table_zones z on z.id = x.zone_id
        left join public.tables t on t.id = x.table_id), '[]'::jsonb))
  ) into v_out;
  return v_out;
end $$;

-- ── VIP on or off (bar / owner) ──────────────────────────────────────────
create or replace function public.set_customer_vip(p_branch uuid, p_key text, p_vip boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_person text;
  v_cid uuid;
  v_phones text[] := '{}';
  v_days integer;
  v_name text;
  v_phone text;
  n integer := 0;
  keys_changed integer := 0;
  rows_now integer;
  d record;
begin
  perform private.require_role(p_branch, array['bar', 'owner']::public.user_role[]);
  if p_vip is null then raise exception 'invalid' using errcode = '22023'; end if;
  v_person := private.resolve_person(p_branch, p_key);
  if v_person is null or not exists (select 1 from private.branch_people_map(p_branch) m where m.person = v_person) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_person like 'n-%' then raise exception 'NO_CUSTOMER_KEY' using errcode = '22023'; end if;
  if v_person like 'c-%' then
    v_cid := substr(v_person, 3)::uuid;
    v_phones := private.customer_phones(p_branch, v_cid);
  else
    v_phones := array[substr(v_person, 3)];
  end if;
  select b.deposit_days into v_days from public.branches b where b.id = p_branch;

  -- the name and phone the audit log shows: the latest ones used here
  select x.nm, x.ph into v_name, v_phone from (
    select dp.customer_name as nm, dp.customer_phone as ph, dp.created_at as at
    from private.branch_people_map(p_branch) m join public.deposits dp on dp.id = m.id where m.kind = 'd' and m.person = v_person
    union all
    select bk.name, bk.phone, bk.created_at
    from private.branch_people_map(p_branch) m join public.bookings bk on bk.id = m.id where m.kind = 'b' and m.person = v_person
  ) x order by x.at desc limit 1;

  if p_vip then
    if v_cid is not null then
      insert into public.customer_vips (branch_id, customer_id, created_by) values (p_branch, v_cid, auth.uid()) on conflict do nothing;
      get diagnostics keys_changed = row_count;
    end if;
    insert into public.customer_vips (branch_id, phone_key, created_by)
    select p_branch, k, auth.uid() from unnest(v_phones) as k on conflict do nothing;
    get diagnostics rows_now = row_count;
    keys_changed := keys_changed + rows_now;
    for d in
      select dp.id, dp.status from private.branch_people_map(p_branch) m join public.deposits dp on dp.id = m.id
      where m.kind = 'd' and m.person = v_person and not dp.is_vip
        and dp.status in ('pending_confirm', 'in_store', 'pending_withdrawal', 'expired')
      order by dp.created_at
      for update of dp
    loop
      update public.deposits set is_vip = true, expires_at = null, expiry_notice_sent_at = null, expired_notice_sent_at = null,
        status = case when d.status = 'expired' then 'in_store'::public.deposit_status else d.status end
      where id = d.id;
      if d.status = 'expired' then perform private.refresh_deposit(d.id); end if;
      perform private.log_event(d.id, p_branch, 'vip_on', jsonb_build_object('customer', true));
      n := n + 1;
    end loop;
  else
    -- every phone this customer used here, theirs alone or not, and their LINE id
    delete from public.customer_vips v
    where v.branch_id = p_branch
      and ((v_cid is not null and v.customer_id = v_cid)
        or v.phone_key = any (v_phones)
        or v.phone_key in (
          select private.phone_key(dp.customer_phone) from private.branch_people_map(p_branch) m
          join public.deposits dp on dp.id = m.id where m.kind = 'd' and m.person = v_person
          union
          select private.phone_key(bk.phone) from private.branch_people_map(p_branch) m
          join public.bookings bk on bk.id = m.id where m.kind = 'b' and m.person = v_person));
    get diagnostics keys_changed = row_count;
    for d in
      select dp.id from private.branch_people_map(p_branch) m join public.deposits dp on dp.id = m.id
      where m.kind = 'd' and m.person = v_person and dp.is_vip
        and dp.status in ('pending_confirm', 'in_store', 'pending_withdrawal')
      order by dp.created_at
      for update of dp
    loop
      update public.deposits set is_vip = false, expires_at = now() + make_interval(days => v_days),
        expiry_notice_sent_at = null, expired_notice_sent_at = null
      where id = d.id;
      perform private.log_event(d.id, p_branch, 'vip_off', jsonb_build_object('customer', true));
      n := n + 1;
    end loop;
  end if;

  -- pressing it again changes nothing and logs nothing
  if keys_changed > 0 or n > 0 then
    perform private.audit(p_branch, 'deposit', case when p_vip then 'customer.vip_on' else 'customer.vip_off' end,
      v_name, v_cid, jsonb_build_object('deposits_changed', n, 'phone', v_phone), null);
  end if;
  return jsonb_build_object('key', v_person, 'is_vip', p_vip, 'deposits', n);
end $$;

-- ── grants ───────────────────────────────────────────────────────────────
-- phone_key runs in index expressions for whoever writes those tables; customer_is_vip runs in the
-- (invoker) bar-only guard
revoke all on function private.phone_key(text) from public, anon;
grant execute on function private.phone_key(text) to authenticated, service_role;
revoke all on function private.customer_is_vip(uuid, uuid, text) from public, anon;
grant execute on function private.customer_is_vip(uuid, uuid, text) to authenticated, service_role;
revoke all on function private.phone_owner(uuid, text) from public, anon, authenticated;
revoke all on function private.customer_phones(uuid, uuid) from public, anon, authenticated;
revoke all on function private.person_of(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.resolve_person(uuid, text) from public, anon, authenticated;
revoke all on function private.branch_phone_owners(uuid) from public, anon, authenticated;
revoke all on function private.branch_people_map(uuid) from public, anon, authenticated;
revoke all on function private.deposit_customer_vip() from public, anon, authenticated;
revoke all on function private.deposit_customer_vip_log() from public, anon, authenticated;

revoke all on function public.customer_list(uuid, text, text, integer, integer) from public, anon;
revoke all on function public.customer_detail(uuid, text, integer, integer, integer) from public, anon;
revoke all on function public.set_customer_vip(uuid, text, boolean) from public, anon;
grant execute on function public.customer_list(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.customer_detail(uuid, text, integer, integer, integer) to authenticated;
grant execute on function public.set_customer_vip(uuid, text, boolean) to authenticated;
