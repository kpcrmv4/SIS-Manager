-- SQL does not promise left-to-right AND: `topic like 'print:%' and substr(topic, 7)::uuid`
-- could cast ':<uuid>' from a 'branch:' topic and fail the whole policy (CHANNEL_ERROR for
-- every subscriber). Parse the topic with a helper that returns null instead of raising.
create or replace function private.topic_id(p_topic text, p_prefix text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if p_topic is null or left(p_topic, length(p_prefix)) <> p_prefix then return null; end if;
  return substr(p_topic, length(p_prefix) + 1)::uuid;
exception when others then return null;
end $$;
revoke all on function private.topic_id(text, text) from public, anon;
grant execute on function private.topic_id(text, text) to authenticated, service_role;

drop policy if exists sis_realtime_receive on realtime.messages;
create policy sis_realtime_receive on realtime.messages for select to authenticated using (
  private.topic_id(realtime.topic(), 'branch:') in (select private.my_branch_ids())
  or private.topic_id(realtime.topic(), 'user:') = (select auth.uid())
  or private.topic_id(realtime.topic(), 'print:') = (select private.print_branch())
);
