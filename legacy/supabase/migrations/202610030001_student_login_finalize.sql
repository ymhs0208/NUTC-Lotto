-- Apply after project_rows and student_lookup. No roster/session rewrite.
begin;
create or replace function public.ntcust_student_login_finalize(
  p_project_id text, p_leader_key text, p_password_hash text,
  p_shared_password_mode boolean, p_token_hash text, p_credential_version text,
  p_old_token_hash text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_project jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_credential_version is null or p_credential_version !~ '^[a-f0-9]{64}$'
    or p_password_hash is null or p_password_hash !~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$'
    or p_credential_version is distinct from encode(sha256(convert_to(p_password_hash, 'UTF8')), 'hex')
    or p_shared_password_mode is null
    or (p_old_token_hash is not null and (p_old_token_hash !~ '^[a-f0-9]{64}$' or p_old_token_hash = p_token_hash)) then
    raise exception using errcode = '22023', message = 'Invalid login parameters';
  end if;
  -- SHARE permits concurrent students while blocking credential edits/deletion
  -- until insertion commits. Never lock the global lottery state row.
  select document into current_project from public.ntcust_projects
    where id = p_project_id and leader_key = p_leader_key for share;
  if not found or current_project ? 'password'
    or (current_project ->> 'password_hash') is distinct from p_password_hash
    or coalesce(current_project ->> 'shared_password_mode', 'false') is distinct from p_shared_password_mode::text then
    raise exception using errcode = 'PT401', message = 'Student credentials changed';
  end if;
  -- Insert before deleting: any error rolls back both operations, preserving
  -- the previous login. Expiry is set by the database, never the browser.
  insert into public.ntcust_student_sessions(token_hash, project_id, credential_version, expires_at)
    values (p_token_hash, p_project_id, p_credential_version, clock_timestamp() + interval '1 hour');
  if p_old_token_hash is not null then
    delete from public.ntcust_student_sessions where token_hash = p_old_token_hash;
  end if;
  return current_project;
end;
$$;
revoke all on function public.ntcust_student_login_finalize(text, text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.ntcust_student_login_finalize(text, text, text, boolean, text, text, text) to service_role;
notify pgrst, 'reload schema';
commit;
