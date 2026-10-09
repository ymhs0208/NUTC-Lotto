-- Requires project_rows. Read the version/config/results in one SQL snapshot.
-- A matching cache version omits rows while still checking committed DB state.
begin;
create or replace function public.ntcust_public_results_snapshot(
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
          p.document -> 'draw_order' asc, p.id asc)
        from public.ntcust_projects p
        where p.document ->> 'field' = p_field
          and p.document -> 'draw_order' > '0'::jsonb
          and p.document ->> 'draw_code' is not null
          and p.document ->> 'draw_code' <> ''
      ), '[]'::jsonb) end
  ) from public.ntcust_lottery_state s where s.id = 1;
$$;
revoke all on function public.ntcust_public_results_snapshot(text, integer) from public, anon, authenticated;
grant execute on function public.ntcust_public_results_snapshot(text, integer) to service_role;
notify pgrst, 'reload schema';
commit;
