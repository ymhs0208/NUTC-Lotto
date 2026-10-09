-- Apply after project_rows. The API falls back only while this RPC is absent.
begin;
create function public.ntcust_student_lookup(p_token_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('project', p.document, 'credential_version', s.credential_version)
  from public.ntcust_student_sessions s
  join public.ntcust_projects p on p.id = s.project_id
  where s.token_hash = p_token_hash and s.expires_at > now();
$$;
-- Password fingerprint verification remains in the backend. No public client
-- may use this function to retrieve project documents or credential hashes.
revoke all on function public.ntcust_student_lookup(text) from public, anon, authenticated;
grant execute on function public.ntcust_student_lookup(text) to service_role;
notify pgrst, 'reload schema';
commit;
