-- Apply after project_rows. Append-only records; business writes and logs commit together.
begin;
create table if not exists public.ntcust_staff_audit (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id text not null,
  actor_email text not null,
  actor_role text not null check (actor_role in ('admin','stage')),
  action text not null check (action in ('login','logout','shared_password_generate','shared_password_clear','draw','reset')),
  details jsonb not null default '{}'::jsonb,
  search_text text generated always as (lower(actor_email || ' ' || action || ' ' || details::text)) stored
);
create index if not exists ntcust_staff_audit_time on public.ntcust_staff_audit(occurred_at);
create index if not exists ntcust_staff_audit_action_id on public.ntcust_staff_audit(action,id desc);
alter table public.ntcust_staff_audit enable row level security;
revoke all on public.ntcust_staff_audit from public, anon, authenticated, service_role;
grant select on public.ntcust_staff_audit to service_role;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='ntcust_staff_audit' and policyname='staff_audit_backend_read') then
   create policy staff_audit_backend_read on public.ntcust_staff_audit for select to service_role using(true);
 end if;
end $$;

create or replace function public.ntcust_record_staff_event(p_actor jsonb, p_action text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_actor) is distinct from 'object'
    or coalesce(p_actor->>'userId','') = '' or length(p_actor->>'userId') > 128
    or coalesce(p_actor->>'email','') = '' or length(p_actor->>'email') > 256
    or coalesce(p_actor->>'role','') not in ('admin','stage')
    or coalesce(p_action,'') not in ('login','logout','shared_password_generate','shared_password_clear','draw','reset')
    or (p_action like 'shared_password_%' and p_actor->>'role' <> 'admin')
    or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text) > 262144 then
    raise exception using errcode='22023', message='Invalid audit event';
  end if;
  if exists(select 1 from jsonb_object_keys(p_details) k where k not in ('fields','project_count','version','summary')) then
    raise exception using errcode='22023', message='Unsupported audit details';
  end if;
  if p_details ? 'fields' then
    if jsonb_typeof(p_details->'fields') is distinct from 'array' then
      raise exception using errcode='22023',message='Invalid audit fields';
    end if;
    if jsonb_array_length(p_details->'fields') > 100 or exists(
      select 1 from jsonb_array_elements(p_details->'fields') f where jsonb_typeof(f) <> 'string' or length(f#>>'{}') > 512
    ) then raise exception using errcode='22023',message='Invalid audit fields'; end if;
  end if;
  if (p_details ? 'summary' and (jsonb_typeof(p_details->'summary') is distinct from 'string' or length(p_details->>'summary') > 512))
    or (p_details ? 'project_count' and (jsonb_typeof(p_details->'project_count') is distinct from 'number' or coalesce(p_details->>'project_count','') !~ '^(0|[1-9][0-9]{0,3})$' or (p_details->>'project_count')::numeric > 2000))
    or (p_details ? 'version' and (jsonb_typeof(p_details->'version') is distinct from 'number' or coalesce(p_details->>'version','') !~ '^[1-9][0-9]{0,9}$')) then
    raise exception using errcode='22023',message='Invalid audit metadata';
  end if;
  insert into public.ntcust_staff_audit(actor_id,actor_email,actor_role,action,details)
    values(p_actor->>'userId',p_actor->>'email',p_actor->>'role',p_action,p_details);
end;
$$;

create or replace function public.ntcust_save_lottery_state_audited(
 p_projects jsonb, p_domain_configs jsonb, p_expected_version integer,
 p_actor jsonb, p_action text, p_details jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if p_action not in ('shared_password_generate','shared_password_clear','draw','reset') or p_action is null then
   raise exception using errcode='22023',message='Invalid state action';
 end if;
 result := public.ntcust_save_lottery_state(p_projects,p_domain_configs,p_expected_version);
 perform public.ntcust_record_staff_event(p_actor,p_action,p_details);
 return result;
end;
$$;

create or replace function public.ntcust_start_staff_session(p_session jsonb,p_actor jsonb,p_old_token_hash text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if (p_session->>'user_id') is distinct from (p_actor->>'userId') then
   raise exception using errcode='22023',message='Session owner mismatch';
 end if;
 insert into public.ntcust_staff_sessions(token_hash,user_id,access_token,expires_at)
   values(p_session->>'token_hash',(p_session->>'user_id')::uuid,p_session->>'access_token',(p_session->>'expires_at')::timestamptz);
 if p_old_token_hash is not null then
   delete from public.ntcust_staff_sessions where token_hash=p_old_token_hash;
 end if;
 perform public.ntcust_record_staff_event(p_actor,'login','{"summary":"成功登入"}'::jsonb);
end;
$$;
create or replace function public.ntcust_end_staff_session(p_token_hash text,p_actor jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare removed uuid;
begin
 delete from public.ntcust_staff_sessions where token_hash=p_token_hash and user_id::text=p_actor->>'userId'
   returning user_id into removed;
 if found then perform public.ntcust_record_staff_event(p_actor,'logout','{"summary":"成功登出"}'::jsonb); end if;
end;
$$;
revoke all on function public.ntcust_record_staff_event(jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.ntcust_save_lottery_state_audited(jsonb,jsonb,integer,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.ntcust_start_staff_session(jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.ntcust_end_staff_session(text,jsonb) from public,anon,authenticated;
grant execute on function public.ntcust_save_lottery_state_audited(jsonb,jsonb,integer,jsonb,text,jsonb) to service_role;
grant execute on function public.ntcust_start_staff_session(jsonb,jsonb,text) to service_role;
grant execute on function public.ntcust_end_staff_session(text,jsonb) to service_role;
-- Only transactional wrappers append records; even backend has no direct INSERT/UPDATE/DELETE grant.
notify pgrst,'reload schema';
commit;
