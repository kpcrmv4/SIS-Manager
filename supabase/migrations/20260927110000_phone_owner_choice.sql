-- R-059 · (owner request) the phone decides at the counter, not at the QR.
-- Typing a phone that exactly one LINE customer of this branch owns (private.phone_owner) makes the
-- receive form ask "ลูกค้าเดิม · <LINE name> · ใช่คนนี้ไหม":
--   · ใช่       → the deposit is created already linked to that LINE account (same transaction);
--   · ไม่ใช่     → fix the phone; or, for a phone people share, "ใช้เบอร์ร่วมกัน · ฝากโดยไม่ผูก LINE":
--                 the deposit is marked phone_shared and is never linked along with that phone's other
--                 deposits by a QR scan (only a scan of its own QR links it).
-- Staff can only ever pick the phone's owner the database finds — never a customer of their choosing —
-- and never move a phone to another LINE account (R-017 stands for that). The QR sheet of an older
-- unlinked deposit whose phone has an owner offers the same "ผูกกับเจ้าของเบอร์" (link_phone_owner).

alter table public.deposits add column if not exists phone_shared boolean not null default false;
comment on column public.deposits.phone_shared is 'R-059: staff said this phone is shared — a QR scan of another deposit never links this one along.';

-- ── who owns this phone here (the receive form asks as the phone is typed) ─
create or replace function public.phone_customer(p_branch uuid, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare k text := private.phone_key(p_phone); o uuid; nm text; last_name text; open_n int;
begin
  perform private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
  if k is null or length(k) < 9 then return null; end if;
  o := private.phone_owner(p_branch, k);
  if o is null then return null; end if;
  select display_name into nm from public.customers where id = o;
  select d.customer_name into last_name from public.deposits d
  where d.branch_id = p_branch and (d.customer_id = o or private.phone_key(d.customer_phone) = k)
  order by d.created_at desc limit 1;
  select count(*) into open_n from public.deposits d
  where d.branch_id = p_branch and d.customer_id = o and d.status in ('pending_confirm', 'in_store', 'pending_withdrawal', 'expired');
  return jsonb_build_object('customer_id', o, 'name', nm, 'last_name', last_name, 'open', open_n);
end $$;

-- ── apply what the staff chose for a deposit's phone ─────────────────────
create or replace function private.apply_phone_choice(p_deposit uuid, p_choice text, p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype; o uuid;
begin
  select * into d from public.deposits where id = p_deposit for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if d.status in ('withdrawn', 'disposed', 'cancelled') then raise exception 'BAD_STATE' using errcode = '22023'; end if;
  if p_choice = 'shared' then
    update public.deposits set phone_shared = true where id = d.id;
    perform private.log_event(d.id, d.branch_id, 'phone_shared', '{}'::jsonb);
    return;
  end if;
  if p_choice <> 'owner' then raise exception 'BAD_TYPE' using errcode = '22023'; end if;
  if d.customer_id is not null then raise exception 'ALREADY_LINKED' using errcode = '22023'; end if;
  o := private.phone_owner(d.branch_id, private.phone_key(d.customer_phone));
  if o is null or o is distinct from p_customer then raise exception 'NOT_PHONE_OWNER' using errcode = '22023'; end if;
  update public.deposits set customer_id = o, phone_shared = false where id = d.id;
  perform private.log_event(d.id, d.branch_id, 'line_linked', jsonb_build_object('via', 'phone'));
  delete from public.deposit_link_qr where deposit_id = d.id;
end $$;
revoke all on function private.apply_phone_choice(uuid, text, uuid) from public, anon, authenticated;

-- ── receive a deposit and settle its phone in one transaction ────────────
create or replace function public.create_deposit_with_phone(
  p_branch uuid, p_customer_name text, p_item_name text, p_quantity integer, p_photo_paths text[],
  p_customer_phone text default null, p_table text default null, p_item_id uuid default null,
  p_category text default null, p_notes text default null, p_expires_at timestamptz default null,
  p_phone_choice text default null, p_phone_customer uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  res := public.create_deposit(p_branch => p_branch, p_customer_name => p_customer_name, p_item_name => p_item_name,
    p_quantity => p_quantity, p_photo_paths => p_photo_paths, p_customer_phone => p_customer_phone, p_table => p_table,
    p_item_id => p_item_id, p_category => p_category, p_notes => p_notes, p_expires_at => p_expires_at);
  if p_phone_choice is not null then
    perform private.apply_phone_choice((res ->> 'id')::uuid, p_phone_choice, p_phone_customer);
  end if;
  return res;
end $$;

-- ── an older unlinked deposit: link it to its phone's owner from the QR sheet ─
create or replace function public.link_phone_owner(p_deposit uuid, p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  select branch_id into b from public.deposits where id = p_deposit;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_role(b, array['staff', 'bar', 'owner']::public.user_role[]);
  perform private.apply_phone_choice(p_deposit, 'owner', p_customer);
  return jsonb_build_object('id', p_deposit, 'customer_id', p_customer);
end $$;

-- ── R-058 functions again: a shared-phone deposit never links along; the sheet learns the owner's id ─
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
    where x.branch_id = d.branch_id and x.id <> d.id and x.customer_id is null and not x.phone_shared
      and x.status not in ('withdrawn', 'disposed', 'cancelled') and private.phone_key(x.customer_phone) = k;
  end if;

  return jsonb_build_object('token', tok, 'expires_at', exp, 'liff_id', liff,
    'known', owner is not null, 'known_id', owner, 'known_name', owner_name,
    'also', case when owner is null then waiting else 0 end);
end $$;

create or replace function public.customer_link_by_qr(p_branch uuid, p_customer uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lu text; loc public.app_locale; fails int; q public.deposit_link_qr%rowtype; d public.deposits%rowtype;
  k text; owner uuid; was_known boolean; already boolean; ids uuid[]; bot text;
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select line_user_id, locale into lu, loc from public.customers where id = p_customer;
  if lu is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
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
  delete from public.deposit_link_qr where deposit_id = q.deposit_id;

  select * into d from public.deposits where id = q.deposit_id for update;
  if d.status in ('withdrawn', 'disposed', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'BAD_STATE'); end if;
  if d.customer_id is not null and d.customer_id <> p_customer then return jsonb_build_object('ok', false, 'error', 'NOT_YOURS'); end if;
  already := d.customer_id is not null;
  was_known := exists (select 1 from public.deposits x where x.customer_id = p_customer and x.id <> d.id)
            or exists (select 1 from public.bookings b where b.customer_id = p_customer)
            or already;

  k := private.phone_key(d.customer_phone);
  owner := case when k is not null then private.phone_owner(p_branch, k) end;
  select coalesce(array_agg(x.id order by x.created_at), '{}') into ids from (
    select x.id, x.created_at from public.deposits x
    where x.branch_id = p_branch and x.customer_id is null
      and x.status not in ('withdrawn', 'disposed', 'cancelled')
      and (x.id = d.id or (k is not null and not x.phone_shared and (owner is null or owner = p_customer)
                           and private.phone_key(x.customer_phone) = k))
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

revoke all on function public.phone_customer(uuid, text) from public, anon;
revoke all on function public.create_deposit_with_phone(uuid, text, text, integer, text[], text, text, uuid, text, text, timestamptz, text, uuid) from public, anon;
revoke all on function public.link_phone_owner(uuid, uuid) from public, anon;
grant execute on function public.phone_customer(uuid, text) to authenticated;
grant execute on function public.create_deposit_with_phone(uuid, text, text, integer, text[], text, text, uuid, text, text, timestamptz, text, uuid) to authenticated;
grant execute on function public.link_phone_owner(uuid, uuid) to authenticated;
