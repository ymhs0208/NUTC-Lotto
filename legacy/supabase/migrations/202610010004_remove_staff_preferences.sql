-- UI sound settings remain in browser memory; no persisted business data is removed.
-- Keep migration 003 unchanged for installations that already applied it.
drop table if exists public.ntcust_staff_preferences;
