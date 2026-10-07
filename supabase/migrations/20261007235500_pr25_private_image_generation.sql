-- ComicChat PR-25: opt-in official image generation + private Supabase media.
--
-- Reuse-first implementation:
-- - keep the existing GenerationJob / UsageLedger queue;
-- - keep external generation disabled by default;
-- - reuse Supabase private Storage for bytes and RLS;
-- - keep provider URLs/storage locators out of user-visible output_descriptor.
--
-- Enabling this provider is an explicit deployment action and requires an
-- OPENAI_API_KEY in the trusted Edge Function environment. It does not use or
-- claim access to a user's ChatGPT plan allowance.

CREATE TABLE IF NOT EXISTS public.comic_generation_config (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
    external_generation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    provider TEXT NOT NULL DEFAULT 'openai-image'
        CHECK (provider ~ '^[a-z][a-z0-9._-]{0,63}$'),
    billing_source TEXT NOT NULL DEFAULT 'comicchat-sponsored-beta'
        CHECK (billing_source ~ '^[a-z][a-z0-9._-]{0,63}$'),
    model TEXT NOT NULL DEFAULT 'gpt-image-2.5-flare'
        CHECK (CHAR_LENGTH(model) BETWEEN 1 AND 120),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.comic_generation_config(
    singleton_id,
    external_generation_enabled,
    provider,
    billing_source,
    model
)
VALUES (
    1,
    FALSE,
    'openai-image',
    'comicchat-sponsored-beta',
    'gpt-image-2.5-flare'
)
ON CONFLICT (singleton_id) DO NOTHING;

ALTER TABLE public.comic_generation_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.comic_generation_config
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.comic_generation_config TO service_role;

DROP POLICY IF EXISTS comic_generation_config_service_role
    ON public.comic_generation_config;
CREATE POLICY comic_generation_config_service_role
    ON public.comic_generation_config
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Existing messages keep their original provider. Only newly-created jobs read
-- the activation gate. The default remains mock until an operator explicitly
-- enables external generation.
CREATE OR REPLACE FUNCTION public.comic_enqueue_generation_for_message(
    p_message_id UUID,
    p_conversation_id UUID,
    p_sender_id UUID
)
RETURNS public.comic_generation_job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    queued_job public.comic_generation_job%ROWTYPE;
    external_enabled BOOLEAN := FALSE;
    selected_provider TEXT := 'mock';
    selected_billing_source TEXT := 'mock';
BEGIN
    SELECT
        c.external_generation_enabled,
        CASE WHEN c.external_generation_enabled THEN c.provider ELSE 'mock' END,
        CASE WHEN c.external_generation_enabled THEN c.billing_source ELSE 'mock' END
    INTO
        external_enabled,
        selected_provider,
        selected_billing_source
    FROM public.comic_generation_config AS c
    WHERE c.singleton_id = 1;

    IF COALESCE(external_enabled, FALSE) IS FALSE THEN
        selected_provider := 'mock';
        selected_billing_source := 'mock';
    END IF;

    INSERT INTO public.comic_generation_job(
        message_id,
        conversation_id,
        sender_id,
        provider,
        billing_source,
        status
    )
    VALUES (
        p_message_id,
        p_conversation_id,
        p_sender_id,
        selected_provider,
        selected_billing_source,
        'queued'
    )
    ON CONFLICT (message_id) DO NOTHING;

    SELECT *
    INTO queued_job
    FROM public.comic_generation_job AS j
    WHERE j.message_id = p_message_id;

    IF queued_job.id IS NULL
       OR queued_job.conversation_id IS DISTINCT FROM p_conversation_id
       OR queued_job.sender_id IS DISTINCT FROM p_sender_id THEN
        RAISE EXCEPTION 'generation_job_identity_conflict'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.comic_usage_ledger(
        job_id,
        message_id,
        sender_id,
        provider,
        billing_source,
        attempt_no,
        event_type,
        billable_units,
        cost_microunits,
        metadata
    )
    VALUES (
        queued_job.id,
        queued_job.message_id,
        queued_job.sender_id,
        queued_job.provider,
        queued_job.billing_source,
        0,
        'queued',
        0,
        0,
        pg_catalog.jsonb_build_object(
            'reason', 'message_created',
            'external_generation_enabled', COALESCE(external_enabled, FALSE)
        )
    )
    ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;

    RETURN queued_job;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_enqueue_generation_for_message(UUID, UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- User-triggered Edge rendering needs to claim the exact sender-owned message,
-- not an arbitrary global queue item. Only service_role may execute this.
CREATE OR REPLACE FUNCTION public.comic_claim_generation_job_for_message(
    p_message_id UUID,
    p_provider TEXT,
    p_lease_seconds INTEGER DEFAULT 180
)
RETURNS SETOF public.comic_generation_job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    now_utc TIMESTAMPTZ := NOW();
    lease_seconds INTEGER := LEAST(
        GREATEST(COALESCE(p_lease_seconds, 180), 30),
        900
    );
    config_provider TEXT;
    external_enabled BOOLEAN := FALSE;
    candidate public.comic_generation_job%ROWTYPE;
    claimed public.comic_generation_job%ROWTYPE;
    new_lease UUID;
BEGIN
    SELECT c.external_generation_enabled, c.provider
    INTO external_enabled, config_provider
    FROM public.comic_generation_config AS c
    WHERE c.singleton_id = 1;

    IF COALESCE(external_enabled, FALSE) IS FALSE
       OR p_provider IS DISTINCT FROM config_provider THEN
        RAISE EXCEPTION 'provider_not_enabled' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO candidate
    FROM public.comic_generation_job AS j
    WHERE j.message_id = p_message_id
      AND j.provider = p_provider
    FOR UPDATE;

    IF candidate.id IS NULL THEN
        RAISE EXCEPTION 'generation_job_not_found' USING ERRCODE = '22023';
    END IF;

    IF candidate.status = 'ready' OR candidate.status = 'failed' THEN
        RETURN;
    END IF;

    IF candidate.status = 'rendering'
       AND candidate.lease_expires_at > now_utc THEN
        RETURN;
    END IF;

    IF candidate.status = 'rendering'
       AND candidate.lease_expires_at <= now_utc THEN
        INSERT INTO public.comic_usage_ledger(
            job_id,
            message_id,
            sender_id,
            provider,
            billing_source,
            attempt_no,
            event_type,
            metadata
        )
        VALUES (
            candidate.id,
            candidate.message_id,
            candidate.sender_id,
            candidate.provider,
            candidate.billing_source,
            candidate.attempt_count,
            'failed',
            pg_catalog.jsonb_build_object(
                'code', 'lease_expired',
                'retryable', candidate.attempt_count < candidate.max_attempts
            )
        )
        ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;

        IF candidate.attempt_count < candidate.max_attempts THEN
            INSERT INTO public.comic_usage_ledger(
                job_id,
                message_id,
                sender_id,
                provider,
                billing_source,
                attempt_no,
                event_type,
                metadata
            )
            VALUES (
                candidate.id,
                candidate.message_id,
                candidate.sender_id,
                candidate.provider,
                candidate.billing_source,
                candidate.attempt_count,
                'retry_scheduled',
                '{"reason":"lease_expired"}'::JSONB
            )
            ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;
        END IF;
    END IF;

    IF candidate.attempt_count >= candidate.max_attempts THEN
        UPDATE public.comic_generation_job
        SET
            status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            error_code = 'attempts_exhausted',
            error_detail = NULL,
            updated_at = now_utc,
            completed_at = now_utc
        WHERE id = candidate.id;

        UPDATE public.comic_message
        SET status = 'failed', updated_at = now_utc
        WHERE id = candidate.message_id;

        RETURN;
    END IF;

    new_lease := gen_random_uuid();

    UPDATE public.comic_generation_job
    SET
        status = 'rendering',
        attempt_count = candidate.attempt_count + 1,
        lease_token = new_lease,
        lease_expires_at = now_utc
            + pg_catalog.make_interval(secs => lease_seconds),
        output_descriptor = NULL,
        error_code = NULL,
        error_detail = NULL,
        updated_at = now_utc,
        completed_at = NULL
    WHERE id = candidate.id
    RETURNING * INTO claimed;

    UPDATE public.comic_message
    SET status = 'rendering', updated_at = now_utc
    WHERE id = claimed.message_id;

    INSERT INTO public.comic_usage_ledger(
        job_id,
        message_id,
        sender_id,
        provider,
        billing_source,
        attempt_no,
        event_type,
        metadata
    )
    VALUES (
        claimed.id,
        claimed.message_id,
        claimed.sender_id,
        claimed.provider,
        claimed.billing_source,
        claimed.attempt_count,
        'started',
        pg_catalog.jsonb_build_object(
            'lease_expires_at', claimed.lease_expires_at
        )
    )
    ON CONFLICT (job_id, attempt_no, event_type) DO NOTHING;

    RETURN NEXT claimed;
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_claim_generation_job_for_message(UUID, TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comic_claim_generation_job_for_message(UUID, TEXT, INTEGER)
    TO service_role;

-- Supabase Storage is absent from the plain PostgreSQL security harness, so the
-- bucket/policy setup is conditional. In a real/local Supabase stack it creates
-- one private bucket and a read-only membership policy. Browser uploads stay
-- disabled: trusted service-role rendering owns writes.
DO $$
BEGIN
    IF pg_catalog.to_regclass('storage.buckets') IS NOT NULL
       AND pg_catalog.to_regclass('storage.objects') IS NOT NULL THEN
        EXECUTE
            'INSERT INTO storage.buckets(id, name, public) ' ||
            'VALUES (''comicchat-art'', ''comicchat-art'', FALSE) ' ||
            'ON CONFLICT (id) DO UPDATE SET public = FALSE';

        EXECUTE
            'DROP POLICY IF EXISTS comicchat_private_art_select ON storage.objects';

        EXECUTE $policy$
            CREATE POLICY comicchat_private_art_select
            ON storage.objects
            FOR SELECT
            TO authenticated
            USING (
                bucket_id = 'comicchat-art'
                AND public.comic_is_member(
                    CASE
                        WHEN pg_catalog.split_part(name, '/', 1)
                             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                        THEN pg_catalog.split_part(name, '/', 1)::UUID
                        ELSE NULL
                    END
                )
            )
        $policy$;
    END IF;
END;
$$;

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
    bucket_exists BOOLEAN := FALSE;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    IF pg_catalog.to_regclass('storage.buckets') IS NOT NULL THEN
        EXECUTE
            'SELECT EXISTS (' ||
            'SELECT 1 FROM storage.buckets ' ||
            'WHERE id = ''comicchat-art'' AND public IS FALSE' ||
            ')'
        INTO bucket_exists;
    END IF;

    RETURN QUERY
    SELECT
        FALSE,
        bucket_exists,
        FALSE,
        FALSE,
        CASE WHEN bucket_exists THEN 'supabase-private'::TEXT ELSE NULL::TEXT END,
        65536;
END;
$$;

REVOKE ALL ON FUNCTION public.comic_get_media_capabilities()
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comic_get_media_capabilities()
    TO authenticated;

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
    external_enabled BOOLEAN := FALSE;
    configured_provider TEXT := 'openai-image';
    bucket_exists BOOLEAN := FALSE;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    SELECT
        c.external_generation_enabled,
        c.provider
    INTO
        external_enabled,
        configured_provider
    FROM public.comic_generation_config AS c
    WHERE c.singleton_id = 1;

    IF pg_catalog.to_regclass('storage.buckets') IS NOT NULL THEN
        EXECUTE
            'SELECT EXISTS (' ||
            'SELECT 1 FROM storage.buckets ' ||
            'WHERE id = ''comicchat-art'' AND public IS FALSE' ||
            ')'
        INTO bucket_exists;
    END IF;

    RETURN QUERY
    SELECT
        'closed_beta'::TEXT,
        CASE
            WHEN COALESCE(external_enabled, FALSE) THEN configured_provider
            ELSE 'mock'::TEXT
        END,
        COALESCE(external_enabled, FALSE),
        bucket_exists,
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
