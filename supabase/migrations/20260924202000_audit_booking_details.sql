-- R-038 follow-up: on a plain booking edit the old → new pair of a changed night or name must win
-- over the summary fields (name, night, time, party) that every booking row carries — they share
-- keys, and the summary was merged last. Same trigger, merge order reversed.

create or replace function private.audit_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_action text; v_kind text; v_det jsonb; t_old text; t_new text;
begin
  select t.label into t_new from public.tables t where t.id = new.table_id;
  v_det := jsonb_build_object('name', new.name, 'night', new.night, 'time', to_char(new.slot_time, 'HH24:MI'), 'party', new.party_size);
  if tg_op = 'INSERT' then
    v_action := 'booking.created';
    v_kind := case when auth.uid() is not null then 'staff' when new.source = 'line' then 'customer' else 'system' end;
    v_det := v_det || jsonb_build_object('table', t_new, 'status', new.status);
  else
    if new.status is distinct from old.status then
      v_action := 'booking.' || new.status;
    elsif new.table_id is distinct from old.table_id then
      v_action := 'booking.table';
    elsif (to_jsonb(new) - array['updated_at', 'reminder_sent_at']) is distinct from (to_jsonb(old) - array['updated_at', 'reminder_sent_at']) then
      v_action := 'booking.updated';
    else
      return null; -- only a reminder stamp: nothing a person would call a change
    end if;
    v_kind := case when auth.uid() is not null then 'staff'
                   when new.status = 'cancelled' and new.cancelled_by_customer then 'customer'
                   else 'system' end;
    select t.label into t_old from public.tables t where t.id = old.table_id;
    v_det := v_det
      || case when t_old is distinct from t_new then jsonb_build_object('table', jsonb_build_array(t_old, t_new)) else jsonb_build_object('table', t_new) end
      || case when new.status = 'cancelled' and new.status is distinct from old.status then jsonb_build_object('reason', new.cancel_reason)
              when new.status = 'rejected' and new.status is distinct from old.status then jsonb_build_object('reason', new.reject_reason)
              else '{}'::jsonb end
      || case when v_action = 'booking.updated' then private.jsonb_changes(to_jsonb(old), to_jsonb(new),
                array['id', 'branch_id', 'code', 'qr_token', 'created_at', 'updated_at', 'reminder_sent_at', 'table_id', 'status'])
              else '{}'::jsonb end;
  end if;
  perform private.audit(new.branch_id, 'booking', v_action, new.code, new.id, v_det, v_kind);
  return null;
end $$;
revoke all on function private.audit_booking() from public, anon, authenticated;
