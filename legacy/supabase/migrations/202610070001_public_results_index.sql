-- Requires 202610020001_project_rows.sql. Match the public results REST query's
-- JSONB expressions and predicate; keep numeric JSON values for numeric ordering.
begin;

create index if not exists ntcust_projects_public_results
on public.ntcust_projects (
  (document ->> 'field'),
  (document -> 'assigned_group') asc nulls last,
  (document -> 'draw_order') asc,
  id asc
)
where (document -> 'draw_order') > '0'::jsonb
  and (document ->> 'draw_code') is not null
  and (document ->> 'draw_code') <> '';

analyze public.ntcust_projects;
commit;
