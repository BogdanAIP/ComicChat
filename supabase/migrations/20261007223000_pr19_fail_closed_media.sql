-- ComicChat PR-19: fail-closed media boundary.
--
-- No private object storage, signed-media access or public asset URL provider is
-- enabled yet. Until a separately reviewed media provider ships, generation
-- output stored in user-visible job descriptors must remain locator-free.

CREATE OR REPLACE FUNCTION public.comic_generation_output_media_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    descriptor_text TEXT;
BEGIN
    IF NEW.output_descriptor IS NULL THEN
        RETURN NEW;
    END IF;

    descriptor_text := NEW.output_descriptor::TEXT;

    IF pg_catalog.octet_length(descriptor_text) > 65536 THEN
        RAISE EXCEPTION 'output_descriptor_too_large' USING ERRCODE = '22023';
    END IF;

    IF descriptor_text ~* '"(url|uri|public_url|signed_url|download_url|object_key|storage_key|bucket|storage_bucket)"[[:space:]]*:' THEN
        RAISE EXCEPTION 'media_locator_not_enabled' USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comic_generation_output_media_guard
    ON public.comic_generation_job;

CREATE TRIGGER comic_generation_output_media_guard
BEFORE INSERT OR UPDATE OF output_descriptor
ON public.comic_generation_job
FOR EACH ROW
EXECUTE FUNCTION public.comic_generation_output_media_guard();

REVOKE ALL ON FUNCTION public.comic_generation_output_media_guard()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.comic_get_media_capabilities()
RETURNS TABLE (
    client_upload_enabled BOOLEAN,
    private_asset_storage_enabled BOOLEAN,
    signed_asset_access_enabled BOOLEAN,
    public_asset_urls_enabled BOOLEAN,
    active_media_provider TEXT,
    max_output_descriptor_bytes INTEGER
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
        FALSE,
        FALSE,
        FALSE,
        FALSE,
        NULL::TEXT,
        65536;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_get_media_capabilities()
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_get_media_capabilities()
    TO authenticated;
