-- Apply before deploying the new API. Run during a maintenance window: the old
-- API writes the removed projects column and must not remain in service.
begin;
lock table public.ntcust_lottery_state in access exclusive mode;

-- One document per project keeps all existing fields, without loading the roster
-- for a student lookup. Generated keys cannot diverge from their document.
create table public.ntcust_projects (
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  id text generated always as (document ->> 'id') stored primary key,
  leader_key text generated always as (lower(btrim(document ->> 'leader_id', U&'\0020\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))) stored not null,
  constraint ntcust_projects_leader_unique unique (leader_key) deferrable initially deferred,
  position integer not null check (position >= 0),
  constraint ntcust_project_id_nonempty check (length(btrim(id)) > 0),
  constraint ntcust_project_leader_nonempty check (length(leader_key) > 0),
  constraint ntcust_project_no_plaintext check (not (document ? 'password') and not (document ? 'password_set'))
);
create index ntcust_projects_position on public.ntcust_projects(position);
alter table public.ntcust_projects enable row level security;
revoke all on public.ntcust_projects from public, anon, authenticated, service_role;
grant select on public.ntcust_projects to service_role;

-- Preserve order, IDs, hashes and draw results. Constraints abort the entire
-- migration if legacy IDs or normalized leader IDs are duplicated.
insert into public.ntcust_projects(document, position)
select p, ordinality::integer - 1
from public.ntcust_lottery_state s,
     jsonb_array_elements(s.projects) with ordinality as source(p, ordinality);
do $$
declare shared_count integer; shared_hash text;
begin
  select count(*), min(document ->> 'password_hash') into shared_count, shared_hash
    from public.ntcust_projects where document ->> 'shared_password_mode' = 'true';
  if shared_count > 0 and (shared_count <> (select count(*) from public.ntcust_projects)
    or shared_hash is null or shared_hash !~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$'
    or exists (select 1 from public.ntcust_projects
      where (document ->> 'password_hash') is distinct from shared_hash)) then
    raise exception 'Inconsistent shared credentials; repair before migration';
  end if;
end $$;
alter table public.ntcust_lottery_state drop column projects;
revoke insert, update, delete on public.ntcust_lottery_state from service_role;

-- One SQL statement returns a consistent roster/config/version snapshot;
-- separate REST reads could mix two committed versions.
create function public.ntcust_load_lottery_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('projects', coalesce((
    select jsonb_agg(p.document order by p.position) from public.ntcust_projects p
  ), '[]'::jsonb), 'domain_configs', s.domain_configs,
  'version', s.version, 'updated_at', s.updated_at)
  from public.ntcust_lottery_state s where s.id = 1;
$$;

create function public.ntcust_save_lottery_state(
  p_projects jsonb, p_domain_configs jsonb, p_expected_version integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  current_version integer;
  saved_at timestamptz;
  shared_count integer;
  shared_hash text;
begin
  select version into current_version from public.ntcust_lottery_state
    where id = 1 for update;
  if not found then raise exception 'Missing lottery state'; end if;
  if current_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Lottery version conflict';
  end if;
  if p_expected_version is null or jsonb_typeof(p_projects) is distinct from 'array'
    or jsonb_typeof(p_domain_configs) is distinct from 'array'
    or jsonb_array_length(p_projects) > 2000 then
    raise exception using errcode = '22023', message = 'Invalid lottery state';
  end if;
  select count(*), min(p ->> 'password_hash') into shared_count, shared_hash
    from jsonb_array_elements(p_projects) p where p ->> 'shared_password_mode' = 'true';
  if shared_count > 0 and (shared_count <> jsonb_array_length(p_projects)
    or shared_hash is null or shared_hash !~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$'
    or exists (select 1 from jsonb_array_elements(p_projects) p
      where (p ->> 'password_hash') is distinct from shared_hash)) then
    raise exception using errcode = '22023', message = 'Inconsistent shared credentials';
  end if;

  -- Update only changed rows. Deferred leader uniqueness permits leader swaps.
  -- Readers see either the old or new complete roster, never a partial import.
  delete from public.ntcust_projects existing
    where not exists (select 1 from jsonb_array_elements(p_projects) p where p ->> 'id' = existing.id);
  insert into public.ntcust_projects as existing(document, position)
    select p, ordinality::integer - 1
    from jsonb_array_elements(p_projects) with ordinality as source(p, ordinality)
    on conflict (id) do update set document = excluded.document, position = excluded.position
      where existing.document is distinct from excluded.document or existing.position <> excluded.position;
  -- Validate deferred uniqueness before returning a successful RPC response.
  set constraints public.ntcust_projects_leader_unique immediate;
  update public.ntcust_lottery_state
    set domain_configs = p_domain_configs, version = current_version + 1, updated_at = clock_timestamp()
    where id = 1 returning updated_at into saved_at;
  return jsonb_build_object('projects', p_projects, 'domain_configs', p_domain_configs,
    'version', current_version + 1, 'updated_at', saved_at);
end;
$$;
revoke all on function public.ntcust_load_lottery_state() from public, anon, authenticated;
revoke all on function public.ntcust_save_lottery_state(jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.ntcust_load_lottery_state() to service_role;
grant execute on function public.ntcust_save_lottery_state(jsonb, jsonb, integer) to service_role;
-- Ask PostgREST to discover the new functions and table immediately.
notify pgrst, 'reload schema';
commit;
