-- Deploy the updated API, then apply this migration to remove the retired key.
-- v2 lets the API use its compatible query path until this migration is applied.
begin;
lock table public.ntcust_lottery_state in exclusive mode;
lock table public.ntcust_projects in exclusive mode;
update public.ntcust_projects set document = document - 'draw_order' where document ? 'draw_order';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ntcust_projects'::regclass and conname = 'ntcust_project_no_draw_order') then
    alter table public.ntcust_projects add constraint ntcust_project_no_draw_order check (not (document ? 'draw_order'));
  end if;
end $$;
-- Invalidate cached results and concurrent writes after the cleanup.
update public.ntcust_lottery_state set version = version + 1, updated_at = clock_timestamp() where id = 1;
drop index if exists public.ntcust_projects_public_results;
create index ntcust_projects_public_results on public.ntcust_projects (
  (document ->> 'field'),
  (document -> 'assigned_group') asc nulls last,
  (regexp_replace(document ->> 'draw_code', '[0-9]+$', '')) asc,
  ((substring(document ->> 'draw_code' from '([0-9]+)$'))::numeric) asc nulls first,
  (document ->> 'draw_code') asc,
  id asc
) where jsonb_typeof(document -> 'assigned_group') = 'number'
  and document -> 'assigned_group' > '0'::jsonb
  and (document ->> 'assigned_group')::numeric = trunc((document ->> 'assigned_group')::numeric)
  and document ->> 'draw_code' is not null
  and btrim(document ->> 'draw_code') <> '';
create or replace function public.ntcust_public_results_snapshot_v2(
  p_field text default '', p_known_version integer default null
) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'version', s.version,
    'domain_configs', s.domain_configs,
    'results', case
      when p_known_version = s.version then null
      when coalesce(p_field, '') = '' then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'draw_code', p.document ->> 'draw_code',
          'assigned_group', case when jsonb_typeof(p.document -> 'assigned_group') = 'number'
            then p.document -> 'assigned_group' else null end,
          'project_title', p.document ->> 'project_title',
          'leader_name', coalesce(p.document ->> 'leader_name', '')
        ) order by p.document -> 'assigned_group' asc nulls last,
          regexp_replace(p.document ->> 'draw_code', '[0-9]+$', '') asc,
          substring(p.document ->> 'draw_code' from '([0-9]+)$')::numeric asc nulls first,
          p.document ->> 'draw_code' asc, p.id asc)
        from public.ntcust_projects p
        where p.document ->> 'field' = p_field
          and jsonb_typeof(p.document -> 'assigned_group') = 'number'
          and p.document -> 'assigned_group' > '0'::jsonb
          and (p.document ->> 'assigned_group')::numeric = trunc((p.document ->> 'assigned_group')::numeric)
          and p.document ->> 'draw_code' is not null
          and btrim(p.document ->> 'draw_code') <> ''
      ), '[]'::jsonb) end
  ) from public.ntcust_lottery_state s where s.id = 1;
$$;
revoke all on function public.ntcust_public_results_snapshot_v2(text, integer) from public, anon, authenticated;
grant execute on function public.ntcust_public_results_snapshot_v2(text, integer) to service_role;
-- Keep callers of the previous endpoint compatible without using the old key.
create or replace function public.ntcust_public_results_snapshot(
  p_field text default '', p_known_version integer default null
) returns jsonb language sql stable security definer set search_path = '' as $$
  select public.ntcust_public_results_snapshot_v2(p_field, p_known_version);
$$;
revoke all on function public.ntcust_public_results_snapshot(text, integer) from public, anon, authenticated;
grant execute on function public.ntcust_public_results_snapshot(text, integer) to service_role;
notify pgrst, 'reload schema';
commit;
