-- Apply after staff_audit. Only fixed, database-timed retention is permitted.
begin;
create or replace function public.ntcust_cleanup_staff_audit()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cutoff timestamptz := ((current_timestamp at time zone 'Asia/Taipei') - interval '3 months') at time zone 'Asia/Taipei';
  deleted_count integer;
begin
  with expired as (
    select id from public.ntcust_staff_audit
    where occurred_at < cutoff
    order by occurred_at, id
    limit 500
    for update skip locked
  )
  delete from public.ntcust_staff_audit a using expired e
  where a.id = e.id and a.occurred_at < cutoff;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;
revoke all on function public.ntcust_cleanup_staff_audit() from public, anon, authenticated;
grant execute on function public.ntcust_cleanup_staff_audit() to service_role;
comment on function public.ntcust_cleanup_staff_audit() is 'Delete at most 500 staff audit rows older than three calendar months in Asia/Taipei. No caller-supplied cutoff.';
notify pgrst, 'reload schema';
commit;
