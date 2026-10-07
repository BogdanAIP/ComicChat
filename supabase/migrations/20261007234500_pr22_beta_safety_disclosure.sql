-- ComicChat PR-22: authenticated closed-beta safety disclosure.
-- This RPC exposes only current, reviewed product facts. It does not establish
-- a retention duration, legal-compliance claim, provider activation, hard delete,
-- media storage, or publication capability.

CREATE OR REPLACE FUNCTION public.comic_get_beta_safety_status()
RETURNS TABLE (
    stage TEXT,
    generation_provider TEXT,
    external_generation_enabled BOOLEAN,
    media_storage_enabled BOOLEAN,
    public_publication_enabled BOOLEAN,
    hard_delete_enabled BOOLEAN,
    automated_retention_purge_enabled BOOLEAN,
    retention_duration_defined BOOLEAN,
    data_export_enabled BOOLEAN,
    deletion_request_enabled BOOLEAN,
    abuse_reporting_enabled BOOLEAN,
    blocking_enabled BOOLEAN,
    message_rate_limit_per_minute INTEGER,
    incident_response_runbook_available BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    me UUID := auth.uid();
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        'closed_beta'::TEXT,
        'mock'::TEXT,
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        TRUE,
        TRUE,
        TRUE,
        TRUE,
        30,
        TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_get_beta_safety_status()
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_get_beta_safety_status()
    TO authenticated;
