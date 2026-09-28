-- R-068 (owner, 2026-09-28): one deposit form, several liquors — as Davis did. Each item is its own
-- deposit with its own DEP code (and its bottles inside it); all of them are written in one
-- transaction, so an error in any item saves none. The bell, the web push and the staff group's
-- LINE message go out once for the batch, listing every item, instead of once per item.

-- the batch flag: transaction-local, set only while a batch function writes its items
create or replace function private.in_deposit_batch()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('sis.deposit_batch', true), '') = 'on'
$$;
revoke all on function private.in_deposit_batch() from public, anon;
grant execute on function private.in_deposit_batch() to authenticated, service_role;

create or replace function private.notify_on_deposit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d public.deposits%rowtype;
begin
  if new.action not in ('received', 'withdrawal_requested', 'requested') then return new; end if;
  -- R-068: a batch of deposits tells the bell once, from the batch function
  if new.action in ('received', 'requested') and private.in_deposit_batch() then return new; end if;
  select * into d from public.deposits where id = new.deposit_id;
  perform private.notify_members(d.branch_id,
    case when new.action = 'received' then array['bar', 'owner']::public.user_role[] else array['staff', 'bar', 'owner']::public.user_role[] end,
    'deposit_' || new.action,
    jsonb_build_object('deposit_id', d.id, 'code', d.code, 'item', d.item_name, 'customer', d.customer_name, 'table', d.table_label),
    '/deposits/' || d.id);
  return new;
end $$;

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
  -- R-068: inside customer_request_deposits the batch sends one message for all of its items
  if not private.in_deposit_batch() then perform private.notify_staff_group(p_branch, 'deposit_requested',
    jsonb_build_object('deposit_id', new_id, 'code', new_code, 'customer', p_customer_name, 'item', p_item_name,
      'count', p_quantity, 'table', p_table), 'deposit_requested:' || new_id); end if;
  return jsonb_build_object('id', new_id, 'code', new_code);
end $$;

-- staff / bar / owner: the /deposits/new form with 1-10 items
create or replace function public.create_deposits(
  p_branch uuid, p_customer_name text, p_items jsonb, p_photo_paths text[],
  p_customer_phone text default null, p_table text default null, p_notes text default null,
  p_expires_at timestamptz default null, p_phone_choice text default null, p_phone_customer uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int; it jsonb; res jsonb; done jsonb := '[]'::jsonb; summary text;
begin
  perform private.require_role(p_branch, array['staff', 'bar', 'owner']::public.user_role[]);
  n := case when jsonb_typeof(p_items) = 'array' then jsonb_array_length(p_items) else 0 end;
  if n < 1 or n > 10 then raise exception 'BAD_ITEMS' using errcode = '22023'; end if;
  if n > 1 then perform set_config('sis.deposit_batch', 'on', true); end if;
  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' or coalesce(btrim(it ->> 'item_name'), '') = '' or jsonb_typeof(it -> 'quantity') <> 'number' then
      raise exception 'BAD_ITEMS' using errcode = '22023';
    end if;
    res := public.create_deposit_with_phone(p_branch => p_branch, p_customer_name => p_customer_name,
      p_item_name => it ->> 'item_name', p_quantity => (it ->> 'quantity')::integer, p_photo_paths => p_photo_paths,
      p_customer_phone => p_customer_phone, p_table => p_table,
      p_item_id => case when (it ->> 'item_id') ~ '^[0-9a-f-]{36}$' then (it ->> 'item_id')::uuid end,
      p_category => nullif(btrim(it ->> 'category'), ''), p_notes => p_notes, p_expires_at => p_expires_at,
      p_phone_choice => p_phone_choice, p_phone_customer => p_phone_customer);
    done := done || jsonb_build_array(res || jsonb_build_object('item', btrim(it ->> 'item_name'), 'quantity', (it ->> 'quantity')::integer));
  end loop;
  if n > 1 then
    perform set_config('sis.deposit_batch', '', true);
    select string_agg((e ->> 'item') || ' ×' || (e ->> 'quantity'), ' · ') into summary from jsonb_array_elements(done) e;
    perform private.notify_members(p_branch, array['bar', 'owner']::public.user_role[], 'deposit_received',
      jsonb_build_object('deposit_id', done -> 0 ->> 'id', 'code', done -> 0 ->> 'code', 'item', summary,
        'customer', btrim(p_customer_name), 'table', nullif(btrim(p_table), ''), 'items', n),
      '/deposits?tab=toConfirm');
  end if;
  return jsonb_build_object('deposits', done);
end $$;
revoke all on function public.create_deposits(uuid, text, jsonb, text[], text, text, text, timestamptz, text, uuid) from public, anon;
grant execute on function public.create_deposits(uuid, text, jsonb, text[], text, text, text, timestamptz, text, uuid) to authenticated;

-- the LIFF deposit request with 1-10 items (service role, customer verified by the API route)
create or replace function public.customer_request_deposits(
  p_branch uuid, p_customer_id uuid, p_customer_name text, p_items jsonb,
  p_terms_version text, p_terms_locale public.app_locale,
  p_customer_phone text default null, p_table text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int; it jsonb; res jsonb; done jsonb := '[]'::jsonb; summary text; total int;
begin
  if not private.is_service() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  n := case when jsonb_typeof(p_items) = 'array' then jsonb_array_length(p_items) else 0 end;
  if n < 1 or n > 10 then raise exception 'BAD_ITEMS' using errcode = '22023'; end if;
  if n > 1 then perform set_config('sis.deposit_batch', 'on', true); end if;
  for it in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' or coalesce(btrim(it ->> 'item_name'), '') = '' or jsonb_typeof(it -> 'quantity') <> 'number' then
      raise exception 'BAD_ITEMS' using errcode = '22023';
    end if;
    res := public.customer_request_deposit(p_branch => p_branch, p_customer_id => p_customer_id, p_customer_name => p_customer_name,
      p_item_name => it ->> 'item_name', p_quantity => (it ->> 'quantity')::integer,
      p_terms_version => p_terms_version, p_terms_locale => p_terms_locale,
      p_customer_phone => p_customer_phone, p_table => p_table, p_notes => p_notes);
    done := done || jsonb_build_array(res || jsonb_build_object('item', btrim(it ->> 'item_name'), 'quantity', (it ->> 'quantity')::integer));
  end loop;
  if n > 1 then
    perform set_config('sis.deposit_batch', '', true);
    select string_agg((e ->> 'item') || ' ×' || (e ->> 'quantity'), ' · '), sum((e ->> 'quantity')::int)
      into summary, total from jsonb_array_elements(done) e;
    perform private.notify_staff_group(p_branch, 'deposit_requested',
      jsonb_build_object('deposit_id', done -> 0 ->> 'id', 'code', done -> 0 ->> 'code', 'customer', p_customer_name,
        'item', summary, 'count', total, 'table', p_table,
        'items', (select jsonb_agg(jsonb_build_object('deposit_id', e ->> 'id', 'code', e ->> 'code', 'item', e ->> 'item', 'count', (e ->> 'quantity')::int))
                  from jsonb_array_elements(done) e)),
      'deposit_requested:' || (done -> 0 ->> 'id'));
    perform private.notify_members(p_branch, array['staff', 'bar', 'owner']::public.user_role[], 'deposit_requested',
      jsonb_build_object('deposit_id', done -> 0 ->> 'id', 'code', done -> 0 ->> 'code', 'item', summary,
        'customer', btrim(p_customer_name), 'table', nullif(btrim(p_table), ''), 'items', n),
      '/deposits?tab=requests');
  end if;
  return jsonb_build_object('deposits', done);
end $$;
revoke all on function public.customer_request_deposits(uuid, uuid, text, jsonb, text, public.app_locale, text, text, text) from public, anon, authenticated;
grant execute on function public.customer_request_deposits(uuid, uuid, text, jsonb, text, public.app_locale, text, text, text) to service_role;
