-- Read-only export for the old PostgreSQL database. Run once in its SQL editor.
-- Keep the resulting JSON private. It includes student password hashes.
-- The new import deliberately discards these credentials and all old sessions.
SELECT jsonb_build_object(
  'projects', COALESCE((SELECT jsonb_agg(document ORDER BY position) FROM public.ntcust_projects), '[]'::jsonb),
  'domainConfigs', domain_configs,
  'version', version,
  'lastUpdated', updated_at
) AS backup
FROM public.ntcust_lottery_state WHERE id=1;
