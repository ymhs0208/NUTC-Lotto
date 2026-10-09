-- Execute after 202610010001. All legacy plaintext passwords require a reset.
begin;
create table if not exists public.ntcust_student_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  project_id text not null,
  credential_version text not null,
  expires_at timestamptz not null
);
alter table public.ntcust_student_sessions enable row level security;
revoke all on public.ntcust_student_sessions from public, anon, authenticated;
grant select, insert, delete on public.ntcust_student_sessions to service_role;
create index if not exists ntcust_student_sessions_expiry on public.ntcust_student_sessions(expires_at);

-- Remove exposed legacy passwords without keeping predictable credentials working.
update public.ntcust_lottery_state
set projects = coalesce((select jsonb_agg(case
  when p ? 'password' then p - 'password' - 'password_hash' - 'password_set'
  else p - 'password_set' end)
  from jsonb_array_elements(projects) as p), '[]'::jsonb),
  version = version + 1,
  updated_at = now()
where exists (select 1 from jsonb_array_elements(projects) p where p ? 'password' or p ? 'password_set');

-- Defense in depth: reject plaintext passwords even from future privileged writers.
do $$
begin
  if not exists (select 1 from pg_constraint
    where conname = 'ntcust_projects_no_plaintext_password'
      and conrelid = 'public.ntcust_lottery_state'::regclass) then
    alter table public.ntcust_lottery_state add constraint ntcust_projects_no_plaintext_password
      check (not jsonb_path_exists(projects, '$[*].password'));
  end if;
end $$;
commit;
-- Expired session rows can be periodically deleted by a privileged scheduled job:
-- delete from public.ntcust_student_sessions where expires_at < now();
